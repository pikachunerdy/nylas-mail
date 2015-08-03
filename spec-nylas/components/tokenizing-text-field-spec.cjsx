_ = require 'underscore'
React = require 'react/addons'
ReactTestUtils = React.addons.TestUtils

{NylasTestUtils,
 Namespace,
 NamespaceStore,
 Contact,
} = require 'nylas-exports'
{TokenizingTextField, Menu} = require 'nylas-component-kit'

me = new Namespace
  name: 'Test User'
  email: 'test@example.com'
  provider: 'inbox'
NamespaceStore._current = me

CustomToken = React.createClass
  render: ->
    <span>{@props.item.email}</span>

CustomSuggestion = React.createClass
  render: ->
    <span>{@props.item.email}</span>

participant1 = new Contact
  email: 'ben@nylas.com'
participant2 = new Contact
  email: 'burgers@nylas.com'
  name: 'Nylas Burger Basket'
participant3 = new Contact
  email: 'evan@nylas.com'
  name: 'Evan'
participant4 = new Contact
  email: 'tester@elsewhere.com',
  name: 'Tester'
participant5 = new Contact
  email: 'michael@elsewhere.com',
  name: 'Michael'

describe 'TokenizingTextField', ->
  beforeEach ->
    @completions = []
    @propAdd = jasmine.createSpy 'add'
    @propEdit = jasmine.createSpy 'edit'
    @propRemove = jasmine.createSpy 'remove'
    @propEmptied = jasmine.createSpy 'emptied'
    @propTokenKey = jasmine.createSpy("tokenKey").andCallFake (p) -> p.email
    @propTokenIsValid = jasmine.createSpy("tokenIsValid").andReturn(true)
    @propTokenNode = (p) -> <CustomToken item={p} />
    @propOnTokenAction = jasmine.createSpy 'tokenAction'
    @propCompletionNode = (p) -> <CustomSuggestion item={p} />
    @propCompletionsForInput = (input) => @completions

    spyOn(@, 'propCompletionNode').andCallThrough()
    spyOn(@, 'propCompletionsForInput').andCallThrough()

    @tabIndex = 100
    @tokens = [participant1, participant2, participant3]

    @rebuildRenderedField = =>
      @renderedField = ReactTestUtils.renderIntoDocument(
        <TokenizingTextField
          tokens={@tokens}
          tokenKey={@propTokenKey}
          tokenNode={@propTokenNode}
          tokenIsValid={@propTokenIsValid}
          onRequestCompletions={@propCompletionsForInput}
          completionNode={@propCompletionNode}
          onAdd={@propAdd}
          onEdit={@propEdit}
          onRemove={@propRemove}
          onEmptied={@propEmptied}
          onTokenAction={@propOnTokenAction}
          tabIndex={@tabIndex}
          />
      )
      @renderedInput = React.findDOMNode(ReactTestUtils.findRenderedDOMComponentWithTag(@renderedField, 'input'))
    @rebuildRenderedField()

  it 'renders into the document', ->
    expect(ReactTestUtils.isCompositeComponentWithType @renderedField, TokenizingTextField).toBe(true)

  it 'should render an input field', ->
    expect(@renderedInput).toBeDefined()

  it 'applies the tabIndex provided to the inner input', ->
    expect(@renderedInput.tabIndex).toBe(@tabIndex)

  it 'shows the tokens provided by the tokenNode method', ->
    @renderedTokens = ReactTestUtils.scryRenderedComponentsWithType(@renderedField, CustomToken)
    expect(@renderedTokens.length).toBe(@tokens.length)

  it 'shows the tokens in the correct order', ->
    @renderedTokens = ReactTestUtils.scryRenderedComponentsWithType(@renderedField, CustomToken)
    for i in [0..@tokens.length-1]
      expect(@renderedTokens[i].props.item).toBe(@tokens[i])

  describe "prop: tokenIsValid", ->
    it "should be evaluated for each token when it's provided", ->
      @propTokenIsValid = jasmine.createSpy("tokenIsValid").andCallFake (p) =>
        if p is participant2 then true else false

      @rebuildRenderedField()
      @tokens = ReactTestUtils.scryRenderedComponentsWithType(@renderedField, TokenizingTextField.Token)
      expect(@tokens[0].props.valid).toBe(false)
      expect(@tokens[1].props.valid).toBe(true)
      expect(@tokens[2].props.valid).toBe(false)

    it "should default to true when not provided", ->
      @propTokenIsValid = null
      @rebuildRenderedField()
      @tokens = ReactTestUtils.scryRenderedComponentsWithType(@renderedField, TokenizingTextField.Token)
      expect(@tokens[0].props.valid).toBe(true)
      expect(@tokens[1].props.valid).toBe(true)
      expect(@tokens[2].props.valid).toBe(true)

  describe "When the user selects a token", ->
    beforeEach ->
      token = ReactTestUtils.scryRenderedDOMComponentsWithClass(@renderedField, 'token')[0]
      ReactTestUtils.Simulate.click(token)

    it "should mark the token as focused", ->
      expect(@propTokenKey).toHaveBeenCalledWith(participant1)

    it "should set the selectedTokenKeyState", ->
      expect(@renderedField.state.selectedTokenKey).toBe participant1.email

    it "should return the appropriate token objet", ->
      expect(@renderedField._selectedToken()).toBe participant1

  describe "when focused", ->
    it 'should receive the `focused` class', ->
      expect(ReactTestUtils.scryRenderedDOMComponentsWithClass(@renderedField, 'focused').length).toBe(0)
      ReactTestUtils.Simulate.focus(@renderedInput)
      expect(ReactTestUtils.scryRenderedDOMComponentsWithClass(@renderedField, 'focused').length).toBe(1)

  describe "when the user types in the input", ->
    it 'should fetch completions for the text', ->
      ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'abc'}})
      advanceClock(1000)
      expect(@propCompletionsForInput.calls[0].args[0]).toBe('abc')

    it 'should fetch completions on focus', ->
      @renderedField.setState inputValue: "abc"
      ReactTestUtils.Simulate.focus(@renderedInput)
      advanceClock(1000)
      expect(@propCompletionsForInput.calls[0].args[0]).toBe('abc')

    it 'should display the completions', ->
      @completions = [participant4, participant5]
      ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'abc'}})

      components = ReactTestUtils.scryRenderedComponentsWithType(@renderedField, CustomSuggestion)
      expect(components.length).toBe(2)
      expect(components[0].props.item).toBe(participant4)
      expect(components[1].props.item).toBe(participant5)

    it 'should not display items with keys matching items already in the token field', ->
      @completions = [participant2, participant4, participant1]
      ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'abc'}})

      components = ReactTestUtils.scryRenderedComponentsWithType(@renderedField, CustomSuggestion)
      expect(components.length).toBe(1)
      expect(components[0].props.item).toBe(participant4)

    it 'should highlight the first completion', ->
      @completions = [participant4, participant5]
      ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'abc'}})
      components = ReactTestUtils.scryRenderedComponentsWithType(@renderedField, Menu.Item)
      menuItem = components[0]
      expect(menuItem.props.selected).toBe true

    it 'select the clicked element', ->
      @completions = [participant4, participant5]
      ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'abc'}})
      components = ReactTestUtils.scryRenderedComponentsWithType(@renderedField, Menu.Item)
      menuItem = components[0]
      ReactTestUtils.Simulate.mouseDown(React.findDOMNode(menuItem))
      expect(@propAdd).toHaveBeenCalledWith([participant4])

    it "manually enters whatever's in the field when the user presses the space bar as long as it looks like an email", ->
      ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'abc@foo.com '}})
      advanceClock(10)
      expect(@propAdd).toHaveBeenCalledWith("abc@foo.com", skipNameLookup: true)

    it "doesn't sumbmit if it looks like an email but has no space at the end", ->
      ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'abc@foo.com'}})
      advanceClock(10)
      expect(@propCompletionsForInput.calls[0].args[0]).toBe('abc@foo.com')
      expect(@propAdd).not.toHaveBeenCalled()

    it "allows spaces if what's currently being entered doesn't look like an email", ->
      ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'ab'}})
      advanceClock(10)
      ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'ab '}})
      advanceClock(10)
      ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'ab c'}})
      advanceClock(10)
      expect(@propCompletionsForInput.calls[2].args[0]).toBe('ab c')
      expect(@propAdd).not.toHaveBeenCalled()

  [{key:'Enter', keyCode:13}, {key:',', keyCode: 188}].forEach ({key, keyCode}) ->
    describe "when the user presses #{key}", ->
      describe "and there is an completion available", ->
        it "should call add with the first completion", ->
          @completions = [participant4]
          ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'abc'}})
          ReactTestUtils.Simulate.keyDown(@renderedInput, {key: key, keyCode: keyCode})
          expect(@propAdd).toHaveBeenCalledWith([participant4])

      describe "and there is NO completion available", ->
        it 'should call add, allowing the parent to (optionally) turn the text into a token', ->
          @completions = []
          ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'abc'}})
          ReactTestUtils.Simulate.keyDown(@renderedInput, {key: key, keyCode: keyCode})
          expect(@propAdd).toHaveBeenCalledWith('abc', {})

  describe "when the user presses tab", ->
    describe "and there is an completion available", ->
      it "should call add with the first completion", ->
        @completions = [participant4]
        ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'abc'}})
        ReactTestUtils.Simulate.keyDown(@renderedInput, {key: 'Tab', keyCode: 9})
        expect(@propAdd).toHaveBeenCalledWith([participant4])

  describe "when blurred", ->
    it 'should call add, allowing the parent component to (optionally) turn the entered text into a token', ->
      ReactTestUtils.Simulate.focus(@renderedInput)
      ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'text'}})
      ReactTestUtils.Simulate.blur(@renderedInput)
      expect(@propAdd).toHaveBeenCalledWith('text', {})

    it 'should clear the entered text', ->
      ReactTestUtils.Simulate.focus(@renderedInput)
      ReactTestUtils.Simulate.change(@renderedInput, {target: {value: 'text'}})
      ReactTestUtils.Simulate.blur(@renderedInput)
      expect(@renderedInput.value).toBe('')

    it 'should no longer have the `focused` class', ->
      ReactTestUtils.Simulate.focus(@renderedInput)
      expect(ReactTestUtils.scryRenderedDOMComponentsWithClass(@renderedField, 'focused').length).toBe(1)
      ReactTestUtils.Simulate.blur(@renderedInput)
      expect(ReactTestUtils.scryRenderedDOMComponentsWithClass(@renderedField, 'focused').length).toBe(0)

  describe "when the user double-clicks a token", ->
    describe "when an onEdit prop has been provided", ->
      beforeEach ->
        @propEdit = jasmine.createSpy('onEdit')
        @rebuildRenderedField()

      it "should enter editing mode", ->
        tokens = ReactTestUtils.scryRenderedComponentsWithType(@renderedField, TokenizingTextField.Token)
        expect(tokens[0].state.editing).toBe(false)
        ReactTestUtils.Simulate.doubleClick(React.findDOMNode(tokens[0]), {})
        expect(tokens[0].state.editing).toBe(true)

      it "should call onEdit to commit the new token value when the edit field is blurred", ->
        tokens = ReactTestUtils.scryRenderedComponentsWithType(@renderedField, TokenizingTextField.Token)
        token = tokens[0]
        tokenEl = React.findDOMNode(token)

        expect(token.state.editing).toBe(false)
        ReactTestUtils.Simulate.doubleClick(tokenEl, {})
        tokenEditInput = ReactTestUtils.findRenderedDOMComponentWithTag(token, 'input')
        ReactTestUtils.Simulate.change(tokenEditInput, {target: {value: 'new tag content'}})
        ReactTestUtils.Simulate.blur(tokenEditInput)
        expect(@propEdit).toHaveBeenCalledWith(participant1, 'new tag content')

    describe "when no onEdit prop has been provided", ->
      it "should not enter editing mode", ->
        @propEdit = undefined
        @rebuildRenderedField()
        tokens = ReactTestUtils.scryRenderedComponentsWithType(@renderedField, TokenizingTextField.Token)
        expect(tokens[0].state.editing).toBe(false)
        ReactTestUtils.Simulate.doubleClick(React.findDOMNode(tokens[0]), {})
        expect(tokens[0].state.editing).toBe(false)

  describe "When the user removes a token", ->
    it "deletes with the backspace key", ->
      spyOn(@renderedField, "_removeToken")
      ReactTestUtils.Simulate.keyDown(@renderedInput, {key: 'Backspace', keyCode: 8})
      expect(@renderedField._removeToken).toHaveBeenCalled()

    describe "when removal is passed in a token object", ->
      it "asks to removes that participant", ->
        @renderedField._removeToken(participant1)
        expect(@propRemove).toHaveBeenCalledWith([participant1])
        expect(@propEmptied).not.toHaveBeenCalled()

    describe "when no token is selected", ->
      it "selects the last token first and doesn't remove", ->
        @renderedField._removeToken()
        expect(@renderedField._selectedToken()).toBe participant3
        expect(@propRemove).not.toHaveBeenCalled()
        expect(@propEmptied).not.toHaveBeenCalled()

    describe "when a token is selected", ->
      beforeEach ->
        @renderedField.setState selectedTokenKey: participant1.email

      it "removes that token and deselects", ->
        @renderedField._removeToken()
        expect(@propRemove).toHaveBeenCalledWith([participant1])
        expect(@renderedField._selectedToken()).toBeUndefined()
        expect(@propEmptied).not.toHaveBeenCalled()

      it "removes on cut when a token is selected", ->
        @renderedField._onCut({preventDefault: -> })
        expect(@propRemove).toHaveBeenCalledWith([participant1])
        expect(@renderedField._selectedToken()).toBeUndefined()
        expect(@propEmptied).not.toHaveBeenCalled()

    describe "when there are no tokens left", ->
      it "fires onEmptied", ->
        newProps = _.clone @renderedField.props
        newProps.tokens = []
        emptyField = ReactTestUtils.renderIntoDocument(
          React.createElement(TokenizingTextField, newProps)
        )
        emptyField._removeToken()
        expect(@propEmptied).toHaveBeenCalled()
