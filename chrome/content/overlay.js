
let FormMetrics = {
  initialize: function() {
    Components.utils.import("resource://gre/modules/Services.jsm", this);
    Components.utils.import("resource://formmetrics/metrics.jsm", this);
    window.addEventListener("load", this.onLoad, false);
  },

  onLoad: function() {
    let self = FormMetrics;
    window.removeEventListener("load", self.onLoad, false);
    window.addEventListener("unload", self.onUnload, false);
    self.Services.obs.addObserver(self._observer, "earlyformsubmit", false);
  },

  onUnload: function() {
    let self = FormMetrics;
    window.removeEventListener("unload", self.onUnload, false);
    self.Services.obs.removeObserver(self._observer, "earlyformsubmit", false);
  },

  _observer: {
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIFormSubmitObserver]),

    notify: function(aForm, aWindow, aActionURI) {
      try {
        FormMetrics.Metrics.gather(aForm, aWindow, aActionURI, gBrowser);
      }
      catch (e) {
        Cu.reportError(e);
      }

      return true;
    }
  }
}

FormMetrics.initialize();

