Utils = require '../src/flux/models/utils'

Exports =

  # The Task Queue
  Task: require '../src/flux/tasks/task'
  TaskQueue: require '../src/flux/stores/task-queue'

  # The Database
  DatabaseStore: require '../src/flux/stores/database-store'

  # Actions
  Actions: require '../src/flux/actions'

  # API Endpoints
  EdgehillAPI: require '../src/flux/edgehill-api'

  # Testing
  InboxTestUtils: require '../spec-inbox/test_utils'

  # Component Registry
  ComponentRegistry: require '../src/component-registry'

  # Utils
  Utils: Utils
  MessageUtils: require '../src/flux/models/message-utils'

  # Mixins
  UndoManager: require '../src/flux/undo-manager'

  PriorityUICoordinator: require '../src/priority-ui-coordinator'

  # Stores
  DraftStore: require '../src/flux/stores/draft-store'
  MessageStore: require '../src/flux/stores/message-store'
  ContactStore: require '../src/flux/stores/contact-store'
  NamespaceStore: require '../src/flux/stores/namespace-store'
  AnalyticsStore: require '../src/flux/stores/analytics-store'
  WorkspaceStore: require '../src/flux/stores/workspace-store'
  FocusedTagStore: require '../src/flux/stores/focused-tag-store'
  FocusedThreadStore: require '../src/flux/stores/focused-thread-store'
  FileUploadStore: require '../src/flux/stores/file-upload-store'
  FileDownloadStore: require '../src/flux/stores/file-download-store'
  FocusedContactsStore: require '../src/flux/stores/focused-contacts-store'

  ## TODO move to inside of individual Salesforce package. See https://trello.com/c/tLAGLyeb/246-move-salesforce-models-into-individual-package-db-models-for-packages-various-refactors
  SalesforceAssociation: require '../src/flux/models/salesforce-association'
  SalesforceContact: require '../src/flux/models/salesforce-contact'

# Also include all of the model classes
for key, klass of Utils.modelClassMap()
  Exports[klass.name] = klass

module.exports = Exports