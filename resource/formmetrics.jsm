
let EXPORTED_SYMBOLS = ["FormMetrics"];

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let ObserverService = Cc["@mozilla.org/observer-service;1"].
                      getService(Ci.nsIObserverService);
let IOService = Cc["@mozilla.org/network/io-service;1"].
                getService(Ci.nsIIOService2);
let PreferenceService = Cc["@mozilla.org/preferences-service;1"].
                        getService(Ci.nsIPrefService).
                        QueryInterface(Ci.nsIPrefBranch2);
let HistoryService = Cc["@mozilla.org/browser/nav-history-service;1"].
                     getService(Ci.nsINavHistoryService);
let LoginManager = Cc["@mozilla.org/login-manager;1"].
                   getService(Ci.nsILoginManager);
let PrivateBrowsing = Cc["@mozilla.org/privatebrowsing;1"].
                      getService(Ci.nsIPrivateBrowsingService);

// Preference name for the unique id of the client
const PREF_ID = "extensions.formmetrics.id";

// Number of bytes used in client id
const ID_BYTES = 32;

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

// Getters for different type of metrics
let GETTERS = {};

// The unique id of the client
let CLIENT_ID = null;

let initialized = false;
let FormMetrics = {
  init: function() {
    if (initialized)
      return;
    initialized = true;

    // Attempt to retrieve previously stored id
    try {
      CLIENT_ID = PreferenceService.getCharPref(PREF_ID);
    }
    catch (e) {
      Cu.reportError(e);
    }

    if (!CLIENT_ID) {
      try {
        // Generate and store new user id in preference
        let bytes = [];
        for (let i = 0; i < ID_BYTES; i++)
          bytes.push(String.fromCharCode(Math.floor(Math.random() * 256)));
        let value = btoa(bytes.join(''));
        PreferenceService.setCharPref(PREF_ID, value);
        CLIENT_ID = value;
      }
      catch (e) {
        Cu.reportError(e);
      }
    }

    if (!CLIENT_ID)
      return;

    ObserverService.addObserver(observer, "earlyformsubmit", false);
  }
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
          Cu.reportError("FormMetrics submission failed (" + req.status + ")");
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
  get: function(aForm, aWindow, aActionURI) {
    return CLIENT_ID;
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
      form:   this._copy(aWindow.document.documentURIObject),
      top:    this._copy(aWindow.top.document.documentURIObject),
      action: this._copy(aActionURI)
    };
  },

  _copy: function(aURI) {
    let copy = {};
    copy.spec = hash(aURI.spec, "SHA1");
    copy.scheme = aURI.scheme;
    copy.host = hash(aURI.host, "MD5");
    copy.port = aURI.port;
    return copy;
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
      let handler = IOService.getProtocolHandler(aURI.scheme);
      if (port != handler.defaultPort)
        hostname += ":" + port;
    }

    return hostname;
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

// Hash a string using the user's id as a salt
function hash(aString, aAlgorithm) {
  // Get byte array from string
  let converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"].
                  createInstance(Ci.nsIScriptableUnicodeConverter);
  converter.charset = "UTF-8";
  let result = {};
  let data = converter.convertToByteArray(CLIENT_ID + aString, {});

  let ch = Cc["@mozilla.org/security/hash;1"].
           createInstance(Ci.nsICryptoHash);
  ch.initWithString(aAlgorithm);
  ch.update(data, data.length);
  return ch.finish(true);
}

