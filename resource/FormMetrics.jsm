
let EXPORTED_SYMBOLS = ["FormMetrics"];

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://formmetrics/Services.jsm");

// The id of the extension
const EXTENSION_ID = "formmetrics@bparr.com";

// Preference name for the unique id of the client
const PREF_ID = "extensions.formmetrics.id";

// Preference name for the hash salt of the client
const PREF_SALT = "extensions.formmetrics.salt";

// Number of bytes used in client id and client salt
const NUM_BYTES = 32;

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

// The current schema vesion used
const SCHEMA_VERSION = 1;

// Getters for different type of metrics
let GETTERS = {};

// Getters called after the form is submitted, and therefore do not have
// access to the window or form object
let DELAYED_GETTERS = {};

// The unique id of the client that is sent to server
let CLIENT_ID = null;

// The salt used when hashing values
let CLIENT_SALT = null;

let initialized = false;
let FormMetrics = {
  init: function() {
    if (initialized)
      return;
    initialized = true;

    CLIENT_ID = getPreference(PREF_ID);
    CLIENT_SALT = getPreference(PREF_SALT);
    if (!CLIENT_ID || !CLIENT_SALT)
      return;

    Services.obs.addObserver(observer, "earlyformsubmit", false);
  }
}

// Form submission observer
let observer = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIFormSubmitObserver]),

  notify: function(aForm, aWindow, aActionURI) {
    // Ensure function always returns true so the extension doesn't
    // affect form submition at all
    try {
      let data = {
        form:      aForm,
        window:    aWindow,
        formURI:   aWindow.document.documentURIObject.clone(),
        topURI:    aWindow.top.document.documentURIObject.clone(),
        actionURI: aActionURI.clone()
      };

      let metrics = {};
      for (let name in GETTERS)
        metrics[name] = GETTERS[name].get(data);

      // Remove properties from data that are not valid after form is submitted
      data.form = null;
      data.window = null;

      submitMetrics(metrics, data);
    }
    catch (e) {
      Cu.reportError(e);
    }

    return true;
  }
}

// Submit the metrics, with a delay
function submitMetrics(aMetrics, aData) {
  let timer = Cc["@mozilla.org/timer;1"].
              createInstance(Ci.nsITimer);

  timer.initWithCallback({
    notify: function(aTimer) {
      for (let name in DELAYED_GETTERS)
        aMetrics[name] = DELAYED_GETTERS[name].get(aData);

      // Generate request
      let req = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
                createInstance(Ci.nsIXMLHttpRequest);
      req.open("POST", SUBMIT_URL, true);
      req.channel.loadFlags |= Ci.nsIRequest.LOAD_BYPASS_CACHE;
      req.onreadystatechange = function(aEvent) {
        if (req.readyState == 4 && req.status != 200)
          Cu.reportError("FormMetrics submission failed (" + req.status + ")");
      };

      let json = JSON.stringify(aMetrics);
      let queryString = "json=" + encodeURIComponent(json);
      queryString += "&version=" + encodeURIComponent(SCHEMA_VERSION);

      req.setRequestHeader("Content-length", queryString.length);
      req.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
      req.setRequestHeader("Connection", "close");

      req.send(queryString);
    }
  }, SUBMIT_DELAY, timer.TYPE_ONE_SHOT);
}


/*
 * Metrics getters
 */
// The unique id of the client
GETTERS.clientID = {
  get: function(aData) {
    return CLIENT_ID;
  }
}

// Metrics about the time the form was submitted
GETTERS.time = {
  get: function(aData) {
    return Date.now();
  }
}

// Metrics about the form submitted
GETTERS.form = {
  get: function(aData) {
    let form = aData.form;
    let metrics = copy(form, FORM_PROPERTIES);

    let elements = [];
    for (let i = 0, len = form.elements.length; i < len; i++) {
      elements.push(copy(form.elements.item(i), ELEMENT_PROPERTIES));
    }
    metrics.elements = elements;

    return metrics;
  }
}

// Metrics about the URIs
DELAYED_GETTERS.uri = {
  get: function(aData) {
    return {
      form:   this._copy(aData.formURI),
      top:    this._copy(aData.topURI),
      action: this._copy(aData.actionURI)
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
DELAYED_GETTERS.history = {
  get: function(aData) {
    let options = Services.history.getNewQueryOptions();
    options.queryType = options.QUERY_TYPE_HISTORY;
    options.resultType = options.RESULTS_AS_VISIT;

    let query = Services.history.getNewQuery();
    query.domainIsHost = true;
    query.domain = aData.formURI.host;

    let result = Services.history.executeQuery(query, options);
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
DELAYED_GETTERS.bookmarks = {
  get: function(aData) {
    let options = Services.history.getNewQueryOptions();
    options.queryType = options.QUERY_TYPE_BOOKMARKS;
    options.resultType = options.RESULTS_AS_URI;

    let query = Services.history.getNewQuery();
    query.domainIsHost = true;
    query.domain = aData.formURI.host;

    let result = Services.history.executeQuery(query, options);
    let root = result.root;
    root.containerOpen = true;
    return root.childCount;
  }
}

// Metrics about saved passwords
DELAYED_GETTERS.password = {
  get: function(aData) {
    let metrics = {};

    let documentHostname = this._getFormattedHostname(aData.formURI);
    let actionHostname = this._getFormattedHostname(aData.actionURI);

    metrics.documentCount = this._count(documentHostname);

    // Avoid unnecessary call to _count if hostnames are the same
    if (documentHostname == actionHostname)
      metrics.actionCount = metrics.documentCount;
    else
      metrics.actionCount = this._count(actionHostname);

    return metrics;
  },

  _count: function(aHostname) {
    return Services.login.countLogins(aHostname, "", null);
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

// Metrics about wheter the user is in Private Browsing mode
DELAYED_GETTERS.privateBrowsing = {
  get: function(aData) {
    return Services.pb.privateBrowsingEnabled;
  }
}


/*
 * Helper functions
 */
// Get preference value, initializing to random bytes if not found
function getPreference(aPreference) {
  // Attempt to retrieve previously stored value
  try {
    let value = Services.prefs.getCharPref(aPreference);
    if (value)
      return value;
  }
  catch (e) {
    Services.console.logStringMessage("FormMetrics: Unable to get value of " +
                                      aPreference + ". Creating a new value.");
  }

  // Generate and store new value in preference
  try {
    let bytes = [];
    for (let i = 0; i < NUM_BYTES; i++)
      bytes.push(String.fromCharCode(Math.floor(Math.random() * 256)));
    let value = btoa(bytes.join(''));
    Services.prefs.setCharPref(aPreference, value);
    return value;
  }
  catch (e) {
    Cu.reportError(e);
  }

  return null;
}
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
  let data = converter.convertToByteArray(CLIENT_SALT + aString, {});

  let ch = Cc["@mozilla.org/security/hash;1"].
           createInstance(Ci.nsICryptoHash);
  ch.initWithString(aAlgorithm);
  ch.update(data, data.length);
  return ch.finish(true);
}

