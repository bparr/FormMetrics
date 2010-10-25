
let EXPORTED_SYMBOLS = ["Metrics"];

let Cc = Components.classes;
let Ci = Components.interfaces;

let LoginManager = Cc["@mozilla.org/login-manager;1"].
                   getService(Ci.nsILoginManager);
Components.utils.import("resource://gre/modules/Services.jsm");

// Properties to gather from the form itself
const FORM_PROPERTIES = ["id", "name", "method", "target", "length",
                         "className", "title", "baseURI", "hidden",
                         "autocomplete", "encoding"];

// Properties to gather from form elements
const ELEMENT_PROPERTIES = ["tagName", "type", "id", "name", "className",
                            "hidden", "disabled"];

// Properties to gather from nsIURI
const URI_PROPERTIES = ["spec", "scheme", "host", "port", "path"];

// Copy specified object properties to a new object
function copy(aObject, aProperties) {
  let copy = {};
  aProperties.forEach(function(aProperty) {
    copy[aProperty] = aObject[aProperty];
  });

  return copy;
}

// Metrics about the time the form was submitted
let TimeMetrics = {
  get: function(aForm, aWindow, aActionURI, aBrowser) {
    return Date.now();
  }
}

// Metrics about the form submitted
let FormMetrics = {
  get: function(aForm, aWindow, aActionURI, aBrowser) {
    let metrics = copy(aForm, FORM_PROPERTIES);

    let elements = [];
    for (let i = 0, len = aForm.elements.length; i < len; i++) {
      elements.push(copy(aForm.elements.item(i), ELEMENT_PROPERTIES));
    }
    metrics.elements = elements;

    return metrics;
  }
}

// Metrics about the URIs
let URIMetrics = {
  get: function(aForm, aWindow, aActionURI, aBrowser) {
    return {
      form:   copy(aWindow.document.documentURIObject, URI_PROPERTIES),
      top:    copy(aWindow.top.document.documentURIObject, URI_PROPERTIES),
      action: copy(aActionURI, URI_PROPERTIES)
    };
  }
}

// Metrics about saved passwords
let PasswordMetrics = {
  get: function(aForm, aWindow, aActionURI, aBrowser) {
    let metrics = {};

    let documentURIObject = aWindow.document.documentURIObject;
    let documentHostname = this._getFormattedHostname(documentURIObject);
    let actionHostname = this._getFormattedHostname(aActionURI);

    metrics.documentCount = this._count(documentHostname);

    // Avoid unnecessary call to _count if hostnames are the same
    if (documentHostname == actionHostname)
      metrics.actionCount = metrics.documentCount;
    else
      metrics.actionCount = this._count(actionHostname);

    return metrics;
  },

  _count: function(aHostname) {
    return LoginManager.countLogins(aHostname, "", null);
  },

  // Based on the _getFormattedHostname function in mozilla-central's
  // toolkit/components/passwordmgr/src/nsLoginManagerPrompter.js
  _getFormattedHostname: function(aURI) {
    let hostname = aURI.scheme + "://" + aURI.host;

    // Only include port if it's not the scheme's default
    let port = aURI.port;
    if (port != -1) {
      let handler = Services.io.getProtocolHandler(aURI.scheme);
      if (port != handler.defaultPort)
        hostname += ":" + port;
    }

    return hostname;
  }
}

let PinnedMetrics = {
  get: function(aForm, aWindow, aActionURI, aBrowser) {
    let topWindow = aWindow.top;
    let tabs = aBrowser.mTabContainer.childNodes;

    for (let i = 0; i < tabs.length; i++)
      if (tabs[i].linkedBrowser.contentWindow == topWindow)
        return tabs[i].pinned;

    return null;
  }
}

let Metrics = {
  _metrics: [],

  // Getters for different type of metrics
  // TODO implement getters for history, window data
  _getters: {
    time: TimeMetrics,
    form: FormMetrics,
    uris: URIMetrics,
    password: PasswordMetrics,
    pinned: PinnedMetrics
  },

  stringify: function() {
    return JSON.stringify(this._metrics);
  },

  gather: function(aForm, aWindow, aActionURI, aBrowser) {
    let data = {};
    for (let i in this._getters)
      data[i] = this._getters[i].get(aForm, aWindow, aActionURI, aBrowser);

    this._metrics.push(data);
  }
};

