import React from 'react';
import {ipcRenderer, shell} from 'electron';
import {Actions} from 'nylas-exports'
import {RetinaImg} from 'nylas-component-kit';

const clipboard = require('electron').clipboard

export default class OAuthSignInPage extends React.Component {
  static displayName = "OAuthSignInPage";

  static propTypes = {
    /**
     * Step 1: Open a webpage in the user's browser letting them login on
     * the native provider's website. We pass along a key and a redirect
     * url to a Nylas-owned server
     */
    providerAuthPageUrl: React.PropTypes.string,

    /**
     * Step 2: Poll a Nylas server with this function looking for the key.
     * Once users complete the auth successfully, Nylas servers will get
     * the token and vend it back to us via this url. We need to poll
     * since we don't know how long it'll take users to log in on their
     * provider's website.
     */
    tokenRequestPollFn: React.PropTypes.func,

    /**
     * Once we have the token, we can use that to retrieve the full
     * account credentials or establish a direct connection ourselves.
     * Some Nylas backends vend all account credentials along with the
     * token making this function unnecessary and a no-op. Nylas Mail
     * local sync needs to use the returned OAuth token to establish an
     * IMAP connection directly that may have its own set of failure
     * cases.
     */
    accountFromTokenFn: React.PropTypes.func,

    /**
     * Called once we have successfully received the account data from
     * `accountFromTokenFn`
     */
    onSuccess: React.PropTypes.func,

    onTryAgain: React.PropTypes.func,
    iconName: React.PropTypes.string,
    sessionKey: React.PropTypes.string,
    serviceName: React.PropTypes.string,
    accountInfo: React.PropTypes.object,
  };

  constructor() {
    super()
    this.state = {
      authStage: "initial",
      showAlternative: false,
      isCertificateError: false,
    }
    this._tokenData = null
  }

  componentDidMount() {
    // Show the "Sign in to ..." prompt for a moment before bouncing
    // to URL. (400msec animation + 200msec to read)
    this._pollTimer = null;
    this._startTimer = setTimeout(() => {
      shell.openExternal(this.props.providerAuthPageUrl);
      this.startPollingForResponse();
    }, 600);
    setTimeout(() => {
      this.setState({showAlternative: true})
    }, 1500);
  }

  componentWillUnmount() {
    if (this._startTimer) clearTimeout(this._startTimer);
    if (this._pollTimer) clearTimeout(this._pollTimer);
  }

  _handleError(err) {
    const isCertificateError = err.statusCode === 495
    this.setState({authStage: "error", errorMessage: err.message, isCertificateError})
    Actions.recordUserEvent('Email Account Auth Failed', {
      erroredEmail: this.props.accountInfo.email,
      errorMessage: err.message,
      errorLocation: "client",
      provider: "gmail",
    })
  }

  startPollingForResponse() {
    let delay = 1000;
    let onWindowFocused = null;
    let poll = null;
    this.setState({authStage: "polling"})

    onWindowFocused = () => {
      delay = 1000;
      if (this._pollTimer) {
        clearTimeout(this._pollTimer);
        this._pollTimer = setTimeout(poll, delay);
      }
    };

    poll = async () => {
      clearTimeout(this._pollTimer);
      try {
        this._tokenData = await this.props.tokenRequestPollFn(this.props.sessionKey)
        ipcRenderer.removeListener('browser-window-focus', onWindowFocused);
        this.fetchAccountDataWithToken(this._tokenData)
      } catch (err) {
        if (err.statusCode === 404) {
          delay = Math.min(delay * 1.1, 3000);
          this._pollTimer = setTimeout(poll, delay);
        } else {
          ipcRenderer.removeListener('browser-window-focus', onWindowFocused);
          this._handleError(err)
        }
      }
    }

    ipcRenderer.on('browser-window-focus', onWindowFocused);
    this._pollTimer = setTimeout(poll, 3000);
  }

  async fetchAccountDataWithToken(tokenData, {forceTrustCertificate = false} = {}) {
    if (!tokenData) {
      throw new Error('fetchAccountDataWithToken: `tokenData` is required')
    }
    try {
      this.setState({authStage: "fetchingAccount"})
      const accountData = await this.props.accountFromTokenFn(tokenData, {forceTrustCertificate});
      this.props.onSuccess(accountData)
      this.setState({authStage: 'accountSuccess'})
    } catch (err) {
      this._handleError(err)
    }
  }

  _renderCertificateErrorHeader() {
    const {onTryAgain} = this.props
    const {errorMessage} = this.state
    return (
      <div>
        <h2>Sorry, we had trouble logging you in</h2>
        <div className="error-region">
          <p className="message error error-message">{errorMessage}</p>
          <p className="message error error-message">
            The certificate for this server is invalid. Would you like to connect to the server anyway?
          </p>
          <br />
          <div>
            <button
              className="btn btn-large btn-gradient btn-add-account"
              onClick={onTryAgain}
            >
              Try again
            </button>
            <button
              className="btn btn-large btn-gradient btn-add-account"
              onClick={() => this.fetchAccountDataWithToken(this._tokenData, {forceTrustCertificate: true})}
            >
              Connect anyway
            </button>
          </div>
        </div>
      </div>
    )
  }

  _renderHeader() {
    const {serviceName, onTryAgain} = this.props
    const {authStage, isCertificateError, errorMessage} = this.state
    if (authStage === 'initial' || authStage === 'polling') {
      return (<h2>
        Sign in with {serviceName} in<br />your browser.
      </h2>)
    } else if (authStage === 'fetchingAccount') {
      return <h2>Connecting to {serviceName}???</h2>
    } else if (authStage === 'accountSuccess') {
      return (
        <div>
          <h2>Successfully connected to {serviceName}!</h2>
          <h3>Adding your account to Nylas Mail???</h3>
        </div>
      )
    }

    if (isCertificateError) {
      return this._renderCertificateErrorHeader()
    }

    // Error
    return (
      <div>
        <h2>Sorry, we had trouble logging you in</h2>
        <div className="error-region">
          <p className="message error error-message">{errorMessage}</p>
          <p className="extra">Please <a onClick={onTryAgain}>try again</a> later.</p>
        </div>
      </div>
    )
  }

  _renderAlternative() {
    let classnames = "input hidden"
    if (this.state.authStage === "polling" && this.state.showAlternative) {
      classnames += " fadein"
    }

    return (
      <div className="alternative-auth">
        <div className={classnames}>
          <div style={{marginTop: 40}}>
            Page didn&#39;t open? Paste this URL into your browser:
          </div>
          <input
            type="url"
            className="url-copy-target"
            value={this.props.providerAuthPageUrl}
            readOnly
          />
          <div
            className="copy-to-clipboard"
            onClick={() => clipboard.writeText(this.props.providerAuthPageUrl)}
            onMouseDown={() => this.setState({pressed: true})}
            onMouseUp={() => this.setState({pressed: false})}
          >
            <RetinaImg
              name="icon-copytoclipboard.png"
              mode={RetinaImg.Mode.ContentIsMask}
            />
          </div>
        </div>
      </div>
    )
  }

  render() {
    return (
      <div className={`page account-setup ${this.props.serviceName.toLowerCase()}`}>
        <div className="logo-container">
          <RetinaImg
            name={this.props.iconName}
            mode={RetinaImg.Mode.ContentPreserve}
            className="logo"
          />
        </div>
        {this._renderHeader()}
        {this._renderAlternative()}
      </div>
    );
  }
}
