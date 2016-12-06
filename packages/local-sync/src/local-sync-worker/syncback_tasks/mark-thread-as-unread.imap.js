const SyncbackTask = require('./syncback-task')
const TaskHelpers = require('./task-helpers')

class MarkThreadAsUnread extends SyncbackTask {
  description() {
    return `MarkThreadAsUnread`;
  }

  affectsImapMessageUIDs() {
    return false
  }

  run(db, imap) {
    const threadId = this.syncbackRequestObject().props.threadId

    const eachMsg = ({message, box}) => {
      return box.delFlags(message.folderImapUID, 'SEEN')
    }

    return TaskHelpers.forEachMessageInThread({threadId, db, imap, callback: eachMsg})
  }
}
module.exports = MarkThreadAsUnread;
