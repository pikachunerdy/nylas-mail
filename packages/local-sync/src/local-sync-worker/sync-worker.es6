const {
  IMAPConnection,
  IMAPErrors,
} = require('isomorphic-core');
const {
  Actions,
  N1CloudAPI,
  NylasAPIRequest,
  Account: {SYNC_STATE_RUNNING, SYNC_STATE_AUTH_FAILED, SYNC_STATE_ERROR},
} = require('nylas-exports')
const Interruptible = require('../shared/interruptible')
const FetchFolderList = require('./imap/fetch-folder-list')
const FetchMessagesInFolder = require('./imap/fetch-messages-in-folder')
const SyncMetricsReporter = require('./sync-metrics-reporter');
const SyncbackTaskFactory = require('./syncback-task-factory');
const LocalSyncDeltaEmitter = require('./local-sync-delta-emitter').default


class SyncWorker {
  constructor(account, db, parentManager) {
    this._db = db;
    this._manager = parentManager;
    this._conn = null;
    this._account = account;
    this._currentOperation = null
    this._interruptible = new Interruptible()
    this._localDeltas = new LocalSyncDeltaEmitter(db, account.id)

    this._startTime = Date.now();
    this._lastSyncTime = null;
    this._logger = global.Logger.forAccount(account)
    this._interrupted = false
    this._syncInProgress = false
    this._destroyed = false;

    this._syncTimer = setTimeout(() => {
      this.syncNow({reason: 'Initial'});
    }, 0);

    // setup metrics collection. We do this in an isolated way by hooking onto
    // the database, because otherwise things get /crazy/ messy and I don't like
    // having counters and garbage everywhere.
    if (!account.firstSyncCompletion) {
      // TODO extract this into its own module, can use later on for exchange
      this._logger.info("This is initial sync. Setting up metrics collection!");

      let seen = 0;
      db.Thread.addHook('afterCreate', 'metricsCollection', () => {
        if (seen === 0) {
          SyncMetricsReporter.reportEvent({
            type: 'imap',
            emailAddress: account.emailAddress,
            msecToFirstThread: (Date.now() - new Date(account.createdAt).getTime()),
          })
        }
        if (seen === 500) {
          SyncMetricsReporter.reportEvent({
            type: 'imap',
            emailAddress: account.emailAddress,
            msecToFirst500Threads: (Date.now() - new Date(account.createdAt).getTime()),
          })
        }

        if (seen > 500) {
          db.Thread.removeHook('afterCreate', 'metricsCollection')
        }
        seen += 1;
      });
    }
  }

  _getInboxFolder() {
    return this._db.Folder.find({where: {role: ['all', 'inbox']}})
  }

  async _cleanupOrphanMessages() {
    const orphans = await this._db.Message.findAll({
      where: {
        folderId: null,
        isSent: {$not: true},
        isSending: {$not: true},
      },
    })
    return Promise.map(orphans, (msg) => msg.destroy());
  }

  async _ensureAccessToken() {
    if (this._account.provider !== 'gmail') {
      return null
    }

    try {
      const credentials = this._account.decryptedCredentials()
      if (!credentials) {
        throw new Error("ensureAccessToken: There are no IMAP connection credentials for this account.");
      }

      const currentUnixDate = Math.floor(Date.now() / 1000);
      if (currentUnixDate > credentials.expiry_date) {
        const req = new NylasAPIRequest({
          api: N1CloudAPI,
          options: {
            path: `/auth/gmail/refresh`,
            method: 'POST',
            accountId: this._account.id,
          },
        });

        const newCredentials = await req.run()
        this._account.setCredentials(newCredentials);
        await this._account.save()
        return newCredentials
      }
      return null
    } catch (err) {
      this._logger.error(err, 'Unable to refresh access token')
      throw new IMAPErrors.IMAPAuthenticationError(`Unable to refresh access token`)
    }
  }

  async _ensureConnection() {
    const newCredentials = await this._ensureAccessToken()

    if (!newCredentials && this._conn) {
      // We already have a connection and we don't need to update the
      // credentials
      return this._conn.connect();
    }

    if (newCredentials) {
      this._logger.info("Refreshed and updated access token.");
    }

    const settings = this._account.connectionSettings;
    const credentials = newCredentials || this._account.decryptedCredentials();

    if (!settings || !settings.imap_host) {
      throw new Error("_ensureConnection: There are no IMAP connection settings for this account.");
    }
    if (!credentials) {
      throw new Error("_ensureConnection: There are no IMAP connection credentials for this account.");
    }

    const conn = new IMAPConnection({
      db: this._db,
      settings: Object.assign({}, settings, credentials),
      logger: this._logger,
      account: this._account,
    });

    conn.on('mail', () => {
      this._onConnectionIdleUpdate();
    })
    conn.on('update', () => {
      this._onConnectionIdleUpdate();
    })
    conn.on('queue-empty', () => {});

    this._conn = conn;
    return this._conn.connect();
  }

  _onConnectionIdleUpdate() {
    const openBoxName = this._conn ? this._conn.getOpenBoxName() : null
    const isInboxUpdate = (
      openBoxName &&
      ['inbox', '[gmail]/all mail'].includes(openBoxName.toLowerCase())
    )
    if (!isInboxUpdate) { return; }
    this.syncNow({reason: "You've got mail!", interrupt: true});
  }

  _closeConnection() {
    if (this._conn) {
      this._conn.end();
    }
    this._conn = null
  }

  /**
   * Returns a list of at most 100 Syncback requests, sorted by creation date
   * (older first) and by how they affect message IMAP uids.
   *
   * We want to make sure that we run the tasks that affect IMAP uids last, and
   * that we don't  run 2 tasks that will affect the same set of UIDS together,
   * i.e. without running a sync loop in between them.
   *
   * For example, if there's a task to change the labels of a message, and also
   * a task to move that message to another folder, we need to run the label
   * change /first/, otherwise the message would be moved and it would receive a
   * new IMAP uid, and then attempting to change labels with an old uid would
   * fail.
   */
  async _getNewSyncbackTasks() {
    const {SyncbackRequest, Message} = this._db;
    const sendTaskTypes = ['SendMessage', 'SendMessagePerRecipient', 'EnsureMessageInSentFolder']

    const sendTasks = await SyncbackRequest.findAll({
      limit: 100,
      where: {type: sendTaskTypes, status: 'NEW'},
      order: [['createdAt', 'ASC']],
    })
    .map((req) => SyncbackTaskFactory.create(this._account, req))
    const tasks = await SyncbackRequest.findAll({
      limit: 100,
      where: {type: {$notIn: sendTaskTypes}, status: 'NEW'},
      order: [['createdAt', 'ASC']],
    })
    .map((req) => SyncbackTaskFactory.create(this._account, req))

    if (sendTasks.length === 0 && tasks.length === 0) { return [] }

    const tasksToProcess = [
      ...sendTasks,
      ...tasks.filter(t => !t.affectsImapMessageUIDs()),
    ]
    const tasksAffectingUIDs = tasks.filter(t => t.affectsImapMessageUIDs())

    const changeFolderTasks = tasksAffectingUIDs.filter(t =>
      t.description() === 'RenameFolder' || t.description() === 'DeleteFolder'
    )
    if (changeFolderTasks.length > 0) {
      // If we are renaming or deleting folders, those are the only tasks we
      // want to process before executing any other tasks that may change uids.
      // These operations may not change the uids of their messages, but we
      // can't guarantee it, so to make sure, we will just run these.
      const affectedFolderIds = new Set()
      changeFolderTasks.forEach((task) => {
        const {props: {folderId}} = task.syncbackRequestObject()
        if (folderId && !affectedFolderIds.has(folderId)) {
          tasksToProcess.push(task)
          affectedFolderIds.add(folderId)
        }
      })
      return tasksToProcess
    }

    // Otherwise, make sure that we don't process more than 1 task that will affect
    // the UID of the same message
    const affectedMessageIds = new Set()
    for (const task of tasksAffectingUIDs) {
      const {props: {messageId, threadId}} = task.syncbackRequestObject()
      if (messageId) {
        if (!affectedMessageIds.has(messageId)) {
          tasksToProcess.push(task)
          affectedMessageIds.add(messageId)
        }
      } else if (threadId) {
        const messageIds = await Message.findAll({where: {threadId}}).map(m => m.id)
        const shouldIncludeTask = messageIds.every(id => !affectedMessageIds.has(id))
        if (shouldIncludeTask) {
          tasksToProcess.push(task)
          messageIds.forEach(id => affectedMessageIds.add(id))
        }
      }
    }
    return tasksToProcess
  }

  async _runSyncbackTask(task) {
    const syncbackRequest = task.syncbackRequestObject();
    console.log(`🔃 📤 ${task.description()}`, syncbackRequest.props)
    try {
      const responseJSON = await this._conn.runOperation(task);
      syncbackRequest.status = "SUCCEEDED";
      syncbackRequest.responseJSON = responseJSON || {};
      console.log(`🔃 📤 ${task.description()} Succeeded`)
    } catch (error) {
      syncbackRequest.error = error;
      syncbackRequest.status = "FAILED";
      console.error(`🔃 📤 ${task.description()} Failed`, {syncbackRequest: syncbackRequest.toJSON()})
    } finally {
      await syncbackRequest.save();
    }
  }

  async _getFoldersToSync() {
    const {Folder} = this._db;

    // TODO make sure this order is correct/ unit tests!!
    const folders = await Folder.findAll();
    const priority = ['inbox', 'all', 'drafts', 'sent', 'trash', 'spam'].reverse();
    return folders.sort((a, b) =>
      (priority.indexOf(a.role) - priority.indexOf(b.role)) * -1
    )
  }

  _onSyncError(error) {
    this._closeConnection()

    this._logger.error(error, `SyncWorker: Error while syncing account`)

    // Continue to retry if it was a network error
    if (error instanceof IMAPErrors.RetryableError) {
      return Promise.resolve()
    }

    const isAuthError = error instanceof IMAPErrors.IMAPAuthenticationError
    const errorJSON = error.toJSON()
    const accountSyncState = isAuthError ? SYNC_STATE_AUTH_FAILED : SYNC_STATE_ERROR;
    // TODO this is currently a hack to keep N1's account in sync and notify of
    // sync errors. This should go away when we merge the databases
    Actions.updateAccount(this._account.id, {syncState: accountSyncState, syncError: errorJSON})

    this._account.syncError = errorJSON
    return this._account.save()
  }

  async _onSyncDidComplete() {
    const now = Date.now();

    // Save metrics to the account object
    if (!this._account.firstSyncCompletion) {
      this._account.firstSyncCompletion = now;
    }

    const syncGraphTimeLength = 60 * 30; // 30 minutes, should be the same as SyncGraph.config.timeLength
    let lastSyncCompletions = [].concat(this._account.lastSyncCompletions);
    lastSyncCompletions = [now, ...lastSyncCompletions];
    while (now - lastSyncCompletions[lastSyncCompletions.length - 1] > 1000 * syncGraphTimeLength) {
      lastSyncCompletions.pop();
    }

    // TODO this is currently a hack to keep N1's account in sync and notify of
    // sync errors. This should go away when we merge the databases
    Actions.updateAccount(this._account.id, {syncState: SYNC_STATE_RUNNING})

    this._account.lastSyncCompletions = lastSyncCompletions;
    await this._account.save();

    console.log(`🔃 🔚 took ${now - this._syncStart}ms`)
    // this._logger.info('Syncworker: Completed sync cycle');

    // Start idling on the inbox
    const inbox = await this._getInboxFolder();
    if (inbox) {
      await this._conn.openBox(inbox.name);
    }
    // this._logger.info('SyncWorker: Idling on inbox folder');
  }

  async _scheduleNextSync() {
    const {intervals} = this._account.syncPolicy;
    const {Folder} = this._db;

    const folders = await Folder.findAll();
    const moreToSync = folders.some((f) => !f.isSyncComplete())

    // Continue syncing if initial sync isn't done, or if the loop was
    // interrupted or a sync was requested
    const shouldSyncImmediately = (
      moreToSync ||
      this._interrupted
    )

    let reason = "Idle scheduled"
    if (moreToSync) {
      reason = "More to sync"
    } else if (this._interrupted) {
      reason = "Sync interrupted and restarted"
    }
    const interval = shouldSyncImmediately ? 1 : intervals.active;
    const nextSyncIn = Math.max(1, this._lastSyncTime + interval - Date.now())

    // this._logger.info({
    //   moreToSync,
    //   shouldSyncImmediately,
    //   interrupted: this._interrupted,
    //   nextSyncStartingIn: `${nextSyncIn}ms`,
    // }, `SyncWorker: Scheduling next sync iteration`)
    console.log(`🔃 🔜 in ${nextSyncIn}ms`)

    this._syncTimer = setTimeout(() => {
      this.syncNow({reason});
    }, nextSyncIn);
  }

  async _runOperation(operation) {
    this._currentOperation = operation
    await this._conn.runOperation(this._currentOperation)
    this._currentOperation = null
  }

  // This function is interruptible. See Interruptible
  async * _performSync() {
    yield this._account.update({syncError: null});
    yield this._ensureConnection();

    // Step 1: Run any available syncback tasks
    const tasks = yield this._getNewSyncbackTasks()
    for (const task of tasks) {
      await this._runSyncbackTask(task)
      yield  // Yield to allow interruption
    }

    // Step 2: Fetch the folder list. We need to run this before syncing folders
    // because we need folders to sync!
    await this._runOperation(new FetchFolderList(this._account, this._logger))
    yield  // Yield to allow interruption

    // Step 3: Sync each folder, sorted by inbox first
    // TODO prioritize syncing all of inbox first if there's a ton of folders (e.g. imap
    // accounts). If there are many folders, we would only sync the first n
    // messages in the inbox and not go back to it until we've done the same for
    // the rest of the folders, which would give the appearance of the inbox
    // syncing slowly. This should only be done during initial sync.
    // TODO Also consider using multiple imap connections, 1 for inbox, one for the
    // rest
    const sortedFolders = yield this._getFoldersToSync()
    const {folderSyncOptions} = this._account.syncPolicy;
    for (const folder of sortedFolders) {
      await this._runOperation(new FetchMessagesInFolder(folder, folderSyncOptions, this._logger))
      yield  // Yield to allow interruption
    }
  }


  // Public API:

  async syncNow({reason, interrupt = false} = {}) {
    if (this._syncInProgress) {
      if (interrupt) {
        this.interrupt()
      }
      return;
    }

    this._syncStart = Date.now()
    clearTimeout(this._syncTimer);
    this._syncTimer = null;
    this._interrupted = false
    this._syncInProgress = true

    try {
      await this._account.reload();
    } catch (err) {
      this._logger.error({err}, `SyncWorker: Account could not be loaded. Sync worker will exit.`)
      this._manager.removeWorkerForAccountId(this._account.id);
      return;
    }

    // TODO close imap connection every once in a while To prevent sync loop from
    // getting stuck

    console.log(`🔃 🆕 reason: ${reason}`)
    try {
      await this._interruptible.run(this._performSync, this)
      await this._cleanupOrphanMessages();
      await this._onSyncDidComplete();
    } catch (error) {
      await this._onSyncError(error);
    } finally {
      this._lastSyncTime = Date.now()
      this._syncInProgress = false
      await this._scheduleNextSync()
    }
  }

  interrupt() {
    this._interruptible.interrupt()
    if (this._currentOperation) {
      this._currentOperation.interrupt()
    }
    this._interrupted = true
  }

  cleanup() {
    clearTimeout(this._syncTimer);
    this._syncTimer = null;
    this._destroyed = true;
    this._closeConnection()
  }
}

module.exports = SyncWorker;
