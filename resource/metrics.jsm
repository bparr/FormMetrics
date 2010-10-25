
let EXPORTED_SYMBOLS = ["Metrics"];

// Properties to gather from the form itself
const FORM_PROPERTIES = ["id", "name", "method", "target", "length",
                         "className", "title", "baseURI", "hidden",
                         "autocomplete", "encoding"];

// Properties to gather from form elements
const ELEMENT_PROPERTIES = ["tagName", "type", "id", "name", "className",
                            "hidden", "disabled"];

// Properties to gather from nsIURI
const URI_PROPERTIES = ["spec", "scheme", "host", "port", "path"];

let Metrics = {
  _metrics: [],

  stringify: function() {
    return JSON.stringify(this._metrics);
  },

  gather: function(aForm, aWindow, aActionURI) {
    let data = {};

    // Gather data about form
    data.form = this._copy(aForm, FORM_PROPERTIES);

    let elements = [];
    for (let i = 0, len = aForm.elements.length; i < len; i++) {
      elements.push(this._copy(aForm.elements.item(i), ELEMENT_PROPERTIES));
    }
    data.form.elements = elements;

    // Gather data about the window
    // TODO gather other properties from aWindow?
    let documentURIObject = aWindow.document.documentURIObject;
    data.documentURI = this._copy(documentURIObject, URI_PROPERTIES);

    // Gather data about the action URI
    data.actionURI = this._copy(aActionURI, URI_PROPERTIES);

    // TODO history, saved password, pinned tab

    // Gather other data
    data.time = Date.now();

    this._metrics.push(data);
  },

  _copy: function(aObject, aProperties) {
    let copy = {};
    aProperties.forEach(function(aProperty) {
      copy[aProperty] = aObject[aProperty];
    });

    return copy;
  }
};

