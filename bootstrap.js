
let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let LoginManager = Cc["@mozilla.org/login-manager;1"].
                   getService(Ci.nsILoginManager);
let PrivateBrowsing = Cc["@mozilla.org/privatebrowsing;1"].
                      getService(Ci.nsIPrivateBrowsingService);

// The url to send the form data to
const SUBMIT_URL = "https://bparr.homelinux.com/formmetrics.php";

// Properties to gather from the form itself
const FORM_PROPERTIES = ["id", "name", "method", "target", "length",
                         "className", "title", "baseURI", "hidden",
                         "autocomplete", "encoding"];

// Properties to gather from form elements
const ELEMENT_PROPERTIES = ["tagName", "type", "id", "name", "className",
                            "hidden", "disabled"];

// Properties to gather from nsIURI
const URI_PROPERTIES = ["spec", "scheme", "host", "port", "path"];

// Getters for different type of metrics
// TODO implement getters for history, window data
let GETTERS = {};


/*
 * Bootstrap functions
 */
function install(aData, aReason) {}
function uninstall(aData, aReason) {}

function startup(aData, aReason) {
  Services.obs.addObserver(observer, "earlyformsubmit", false);
}

function shutdown(aData, aReason) {
  Services.obs.removeObserver(observer, "earlyformsubmit", false);
}

let observer = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIFormSubmitObserver]),

  notify: function(aForm, aWindow, aActionURI) {
    // Ensure function always returns true so the extension doesn't
    // affect form submition at all
    try {
      let data = {};
      for (let i in GETTERS)
        data[i] = GETTERS[i].get(aForm, aWindow, aActionURI);

      // Submit data
      let formData = Cc["@mozilla.org/files/formdata;1"].
                     createInstance(Ci.nsIDOMFormData);
      formData.append("json", JSON.stringify(data));

      let req = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
                createInstance(Ci.nsIXMLHttpRequest);
      req.open("POST", SUBMIT_URL, true);
      req.channel.loadFlags |= Ci.nsIRequest.LOAD_BYPASS_CACHE;
      req.onreadystatechange = function(aEvent) {
        if (req.readyState == 4 && req.status != 200)
          aWindow.alert("FormMetrics submission failed (" + req.status + ")");
      };

      req.send(formData);
    }
    catch (e) {
      Cu.reportError(e);
    }

  return true;
  }
}


/*
 * Metrics getters
 */
// Metrics about the time the form was submitted
GETTERS.time = {
  get: function(aForm, aWindow, aActionURI) {
    return Date.now();
  }
}

// Metrics about the form submitted
GETTERS.form = {
  get: function(aForm, aWindow, aActionURI) {
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
GETTERS.uri = {
  get: function(aForm, aWindow, aActionURI) {
    return {
      form:   copy(aWindow.document.documentURIObject, URI_PROPERTIES),
      top:    copy(aWindow.top.document.documentURIObject, URI_PROPERTIES),
      action: copy(aActionURI, URI_PROPERTIES)
    };
  }
}

// Metrics about saved passwords
GETTERS.password = {
  get: function(aForm, aWindow, aActionURI) {
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

// Metrics about whether the form is from a pinned tab
GETTERS.pinned = {
  get: function(aForm, aWindow, aActionURI) {
    let topWindow = aWindow.top;
    let tabs = getMainWindow(aWindow).gBrowser.mTabContainer.childNodes;

    for (let i = 0; i < tabs.length; i++)
      if (tabs[i].linkedBrowser.contentWindow == topWindow)
        return tabs[i].pinned;

    return null;
  }
}

// Metrics about wheter the user is in Private Browsing mode
GETTERS.privateBrowsing = {
  get: function(aForm, aWindow, aActionURI) {
    return PrivateBrowsing.privateBrowsingEnabled;
  }
}


/*
 * Helper functions
 */
// Copy specified object properties to a new object
function copy(aObject, aProperties) {
  let copy = {};
  aProperties.forEach(function(aProperty) {
    copy[aProperty] = aObject[aProperty];
  });

  return copy;
}

// Get main window from form window
function getMainWindow(aWindow) {
  return aWindow.QueryInterface(Ci.nsIInterfaceRequestor).
                 getInterface(Ci.nsIWebNavigation).
                 QueryInterface(Ci.nsIDocShellTreeItem).
                 rootTreeItem.
                 QueryInterface(Ci.nsIInterfaceRequestor).
                 getInterface(Ci.nsIDOMWindow);
}

