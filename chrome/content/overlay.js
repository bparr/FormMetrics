
Components.utils.import("resource://gre/modules/Services.jsm");

var FormMetrics = {
  initialize: function() {
    window.addEventListener("load", this.onLoad, false);
  },

  onLoad: function() {
    var self = FormMetrics;
    window.removeEventListener("load", self.onLoad, false);
    window.addEventListener("unload", self.onUnload, false);
    Services.obs.addObserver(self._observer, "earlyformsubmit", false);
  },

  onUnload: function() {
    var self = FormMetrics;
    window.removeEventListener("unload", self.onUnload, false);
    Services.obs.removeObserver(self._observer, "earlyformsubmit", false);
  },

  submit: function() {
    alert("Submitted");
  },

  _observer: {
    QueryInterface : XPCOMUtils.generateQI([Ci.nsIFormSubmitObserver]),

    notify: function (formElement, aWindow, actionURI) {
      window.dump("Form submitted\n");
    }
  }
}

FormMetrics.initialize();

