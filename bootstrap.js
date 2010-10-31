
let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let HistoryService = Cc["@mozilla.org/browser/nav-history-service;1"].
                     getService(Ci.nsINavHistoryService);
let LoginManager = Cc["@mozilla.org/login-manager;1"].
                   getService(Ci.nsILoginManager);
let PrivateBrowsing = Cc["@mozilla.org/privatebrowsing;1"].
                      getService(Ci.nsIPrivateBrowsingService);

// Preference name for the unique id of the client
const PREF_ID = "extensions.formmetrics.id";

// The number of milliseconds in a single day
const MILLISECONDS_IN_DAY = 86400000;

// The url to send the form data to
const SUBMIT_URL = "https://bparr.homelinux.com/formmetrics.php";

// The time to wait before submitting the form data
const SUBMIT_DELAY = 1000;

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

// Form submission observer
let observer = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIFormSubmitObserver]),

  notify: function(aForm, aWindow, aActionURI) {
    // Ensure function always returns true so the extension doesn't
    // affect form submition at all
    try {
      let data = {};
      for (let i in GETTERS)
        data[i] = GETTERS[i].get(aForm, aWindow, aActionURI);

      submitMetrics(JSON.stringify(data));
    }
    catch (e) {
      Cu.reportError(e);
    }

    return true;
  }
}

// Submit the metrics, with a delay
function submitMetrics(json) {
  let timer = Cc["@mozilla.org/timer;1"].
              createInstance(Ci.nsITimer);

  timer.initWithCallback({
    notify: function(aTimer) {
      let formData = Cc["@mozilla.org/files/formdata;1"].
                     createInstance(Ci.nsIDOMFormData);
      formData.append("json", json);

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
  }, SUBMIT_DELAY, timer.TYPE_ONE_SHOT);
}


/*
 * Metrics getters
 */
// The unique id of the client
GETTERS.clientID = {
  _id: null,

  get: function(aForm, aWindow, aActionURI) {
    if (this._id)
      return this._id;
    if (this._id === false)
      return null;

    let id = false;
    try {
      id = Services.prefs.getCharPref(PREF_ID);
    }
    catch (e) {
      id = this._initialize();
    }

    this._id = id ? id : false;
    return this._id;
  },

  _initialize: function() {
    try {
      Cu.import("resource://services-crypto/WeaveCrypto.js");
      let cryptoSvc = new WeaveCrypto();
      let value = cryptoSvc.generateRandomBytes(32);
      Services.prefs.setCharPref(PREF_ID, value);
      return value;
    }
    catch (e) {
      Cu.reportError(e);
    }

    return null;
  }
}

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

// Metrics about the user's history of the form's host
GETTERS.history = {
  get: function(aForm, aWindow, aActionURI) {
    let options = HistoryService.getNewQueryOptions();
    options.queryType = options.QUERY_TYPE_HISTORY;
    options.resultType = options.RESULTS_AS_VISIT;

    let query = HistoryService.getNewQuery();
    query.domainIsHost = true;
    query.domain = aWindow.document.documentURIObject.host;

    let result = HistoryService.executeQuery(query, options);
    let root = result.root;
    root.containerOpen = true;

    // Group the results by day
    let dayKeys = [];
    let dayMap = {};
    let now = Date.now();
    for (let i = 0; i < root.childCount; i++) {
      let node = root.getChild(i);
      let time = node.time / 1000;
      let daysAgo = parseInt((now - time) / MILLISECONDS_IN_DAY);

      if (!(daysAgo in dayMap)) {
        dayKeys.push(daysAgo);
        dayMap[daysAgo] = 0;
      }
      dayMap[daysAgo]++;
    }

    // Return array where the ith element is the number of times the site
    // was visited i days ago
    dayKeys.sort(function(a, b) a - b);
    let max = dayKeys[dayKeys.length - 1];

    let metrics = [];
    for (let i = 0; i <= max; i++)
      metrics.push((i in dayMap) ? dayMap[i] : 0);

    return metrics;
  }
}

// Metrics about the user's bookmarks of the form's host
GETTERS.bookmarks = {
  get: function(aForm, aWindow, aActionURI) {
    let options = HistoryService.getNewQueryOptions();
    options.queryType = options.QUERY_TYPE_BOOKMARKS;
    options.resultType = options.RESULTS_AS_URI;

    let query = HistoryService.getNewQuery();
    query.domainIsHost = true;
    query.domain = aWindow.document.documentURIObject.host;

    let result = HistoryService.executeQuery(query, options);
    let root = result.root;
    root.containerOpen = true;
    return root.childCount;
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

