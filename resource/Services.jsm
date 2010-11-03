
// Modeled off of toolkit/content/Services.jsm which is unfortunately only
// available for Firefox 4.0
let EXPORTED_SYMBOLS = ["Services"];

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

let Services = {};

XPCOMUtils.defineLazyServiceGetter(Services, "obs",
                                   "@mozilla.org/observer-service;1",
                                   "nsIObserverService");

XPCOMUtils.defineLazyServiceGetter(Services, "io",
                                   "@mozilla.org/network/io-service;1",
                                   "nsIIOService2");

XPCOMUtils.defineLazyGetter(Services, "prefs", function () {
  return Cc["@mozilla.org/preferences-service;1"]
           .getService(Ci.nsIPrefService)
           .QueryInterface(Ci.nsIPrefBranch2);
});

XPCOMUtils.defineLazyServiceGetter(Services, "history",
                                   "@mozilla.org/browser/nav-history-service;1",
                                   "nsINavHistoryService");

XPCOMUtils.defineLazyServiceGetter(Services, "login",
                                   "@mozilla.org/login-manager;1",
                                   "nsILoginManager");

XPCOMUtils.defineLazyServiceGetter(Services, "pb",
                                   "@mozilla.org/privatebrowsing;1",
                                   "nsIPrivateBrowsingService");

XPCOMUtils.defineLazyServiceGetter(Services, "em",
                                   "@mozilla.org/extensions/manager;1",
                                   "nsIExtensionManager");

XPCOMUtils.defineLazyServiceGetter(Services, "console",
                                   "@mozilla.org/consoleservice;1",
                                   "nsIConsoleService");

