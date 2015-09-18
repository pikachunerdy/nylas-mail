NylasStore = require 'nylas-store'
{Actions} = require 'nylas-exports'
qs = require 'querystring'
_ = require 'underscore'
moment = require 'moment'

class DeveloperBarStore extends NylasStore
  constructor: ->
    @_setStoreDefaults()
    @_registerListeners()

  ########### PUBLIC #####################################################

  curlHistory: -> _.sortBy _.values(@_curlHistory), (item) ->
    item.startMoment.valueOf()

  longPollState: -> @_longPollState

  longPollHistory: ->
    # We can't use Utils.deepClone because the deltas contain circular references
    # See delta.attributes._delta = delta
    JSON.parse(JSON.stringify(@_longPollHistory))

  visible: -> @_visible

  ########### PRIVATE ####################################################

  triggerThrottled: ->
    @_triggerThrottled ?= _.throttle(@trigger, 100)
    if atom.getCurrentWindow().isVisible()
      @_triggerThrottled()

  _setStoreDefaults: ->
    @_curlHistory = {}
    @_longPollHistory = []
    @_longPollState = {}
    @_visible = atom.inDevMode()

  _registerListeners: ->
    @listenTo Actions.willMakeAPIRequest, @_onWillMakeAPIRequest
    @listenTo Actions.didMakeAPIRequest, @_onDidMakeAPIRequest
    @listenTo Actions.longPollReceivedRawDeltas, @_onLongPollDeltas
    @listenTo Actions.longPollProcessedDeltas, @_onLongPollProcessedDeltas
    @listenTo Actions.longPollStateChanged, @_onLongPollStateChange
    @listenTo Actions.clearDeveloperConsole, @_onClear
    @listenTo Actions.showDeveloperConsole, @_onShow
    @listenTo Actions.sendFeedback, @_onSendFeedback

  _onShow: ->
    @_visible = true
    @trigger(@)

  _onClear: ->
    @_curlHistory = {}
    @_longPollHistory = []
    @trigger(@)

  _onLongPollDeltas: (deltas) ->
    # Add a local timestamp to deltas so we can display it
    now = new Date()
    delta.timestamp = now for delta in deltas

    # Incoming deltas are [oldest...newest]. Append them to the beginning
    # of our internal history which is [newest...oldest]
    @_longPollHistory.unshift(deltas.reverse()...)
    if @_longPollHistory.length > 200
      @_longPollHistory.length = 200
    @triggerThrottled(@)

  _onLongPollProcessedDeltas: ->
    @triggerThrottled(@)

  _onLongPollStateChange: ({accountId, state}) ->
    @_longPollState[accountId] = state
    @triggerThrottled(@)

  _onWillMakeAPIRequest: ({requestId, request}) =>
    item = @_generateCurlItem({requestId, request})
    @_curlHistory[requestId] = item
    @triggerThrottled(@)

  _onDidMakeAPIRequest: ({requestId, request, statusCode, error}) =>
    item = @_generateCurlItem({requestId, request, statusCode, error})
    @_curlHistory[requestId] = item
    @triggerThrottled(@)

  _generateCurlItem: ({requestId, request, statusCode, error}) ->
    url = request.url
    if request.auth
      url = url.replace('://', "://#{request.auth.user}:#{request.auth.pass}@")
    if request.qs
      url += "?#{qs.stringify(request.qs)}"
    postBody = ""
    postBody = JSON.stringify(request.body).replace(/'/g, '\\u0027') if request.body
    data = ""
    data = "-d '#{postBody}'" unless request.method == 'GET'

    headers = ""
    if request.headers
      for k,v of request.headers
        headers += "-H \"#{k}: #{v}\" "

    statusCode = statusCode ? error?.code ? "pending"

    item =
      id: "curlitemId:#{requestId}"
      command: "curl -X #{request.method} #{headers}#{data} \"#{url}\""
      statusCode: statusCode
      startMoment: moment(request.startTime)

    return item

  _onSendFeedback: ->
    {AccountStore,
     Contact,
     Message,
     DatabaseStore} = require 'nylas-exports'

    user = AccountStore.current().name

    debugData = JSON.stringify({
      queries: _.values(@curlHistory())
    }, null, '\t')

    # Remove API tokens from URLs included in the debug data
    # This regex detects ://user:pass@ and removes it.
    debugData = debugData.replace(/:\/\/(\w)*:(\w)?@/g, '://')

    draft = new Message
      from: [AccountStore.current().me()]
      to: [
        new Contact
          name: "Nylas Team"
          email: "feedback@nylas.com"
      ]
      date: (new Date)
      draft: true
      subject: "Feedback"
      accountId: AccountStore.current().id
      body: """
        Hi, Nylas team! I have some feedback for you.<br/>
        <br/>
        <b>What happened:</b><br/>
        <br/>
        <br/>
        <b>Impact:</b><br/>
        <br/>
        <br/>
        <b>Feedback:</b><br/>
        <br/>
        <br/>
        <b>Environment:</b><br/>
        I'm using Nylas Mail #{atom.getVersion()} and my platform is #{process.platform}-#{process.arch}.<br/>
        --<br/>
        #{user}<br/>
        -- Extra Debugging Data --<br/>
        #{debugData}
      """
    DatabaseStore.persistModel(draft).then ->
      Actions.composePopoutDraft(draft.clientId)

module.exports = new DeveloperBarStore()
