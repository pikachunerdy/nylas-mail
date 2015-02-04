{Message, Actions,DraftStore} = require 'inbox-exports'
EventEmitter = require('events').EventEmitter
_ = require 'underscore-plus'

# As the user interacts with the draft, changes are accumulated in the
# DraftChangeSet associated with the store proxy. The DraftChangeSet does two things:
#
# 1. It debounces changes and calls Actions.saveDraft() at a reasonable interval.
#
# 2. It exposes `applyToModel`, which allows you to optimistically apply changes
#    to a draft object. When the proxy vends the draft, it passes it through this
#    function to apply uncommitted changes. This means the Draft provided by the
#    DraftStoreProxy will always relfect recent changes, even though they're
#    written to the database intermittently.
#
class DraftChangeSet
  constructor: (@localId, @_onChange) ->
    @_pending = {}
    @_timer = null

  add: (changes, immediate) ->
    @_pending = _.extend(@_pending, changes)
    @_onChange()
    if immediate
      @commit()
    else
      clearTimeout(@_timer) if @_timer
      @_timer = setTimeout(@commit, 750)

  commit: =>
    @_pending.localId = @localId
    if Object.keys(@_pending).length > 1
      Actions.saveDraft(@_pending)
      @_pending = {}

  applyToModel: (model) ->
    model.fromJSON(@_pending) if model
    model

# DraftStoreProxy is a small class that makes it easy to implement components
# that display Draft objects or allow for interactive editing of Drafts.
#
# 1. It synchronously provides an instance of a draft via `draft()`, and
#    triggers whenever that draft instance has changed.
#
# 2. It provides an interface for modifying the draft that transparently
#    batches changes, and ensures that the draft provided via `draft()`
#    always has pending changes applied.
#
module.exports =
class DraftStoreProxy

  constructor: (@draftLocalId) ->
    @unlisteners = []
    @unlisteners.push DraftStore.listen(@_onDraftChanged, @)
    @unlisteners.push Actions.didSwapModel.listen(@_onDraftSwapped, @)
    @_emitter = new EventEmitter()
    @_draft = false
    @_reloadDraft()

    @changes = new DraftChangeSet @draftLocalId, =>
      @_emitter.emit('trigger')

  draft: ->
    @changes.applyToModel(@_draft)
    @_draft

  listen: (callback, bindContext) ->
    eventHandler = (args) ->
      callback.apply(bindContext, args)
    @_emitter.addListener('trigger', eventHandler)
    return =>
      @_emitter.removeListener('trigger', eventHandler)
      if @_emitter.listeners('trigger').length == 0
        # Unlink ourselves from the stores/actions we were listening to
        # so that we can be garbage collected
        unlisten() for unlisten in @unlisteners

  _onDraftChanged: (change) ->
    # We don't accept changes unless our draft object is loaded
    return unless @_draft

    # Is this change an update to our draft?
    myDraft = _.find(change.objects, (obj) => obj.id == @_draft.id)
    if myDraft
      @_draft = myDraft
      @_emitter.emit('trigger')

  _onDraftSwapped: (change) ->
    # A draft was saved with a new ID. Since we use the draft ID to
    # watch for changes to our draft, we need to pull again using our
    # localId.
    if change.oldModel.id is @_draft.id
      @_draft = change.newModel
      @_emitter.emit('trigger')

  _reloadDraft: ->
    promise = DraftStore.findByLocalId(@draftLocalId)
    promise.catch (err) ->
      console.log(err)
    promise.then (draft) =>
      @_draft = draft
      @_emitter.emit('trigger')

