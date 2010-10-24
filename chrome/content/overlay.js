
var FormMetrics = {
  initialize: function() {
    window.addEventListener("load", this.onLoad, false);
  },

  onLoad: function() {
    window.removeEventListener("load", FormMetrics.onLoad, false);
    window.addEventListener("unload", FormMetrics.onUnload, false);
  },

  onUnload: function() {
    window.removeEventListener("unload", FormMetrics.onUnload, false);
  },

  submit: function() {
    alert("Submitted");
  }
}

FormMetrics.initialize();

