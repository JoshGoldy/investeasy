/**
 * Minimal stub for JSZip used in test/offline environments.
 */
(function (global) {
  function JSZip() {
    this.files = {};
  }
  JSZip.prototype.file = function(name, content) {
    this.files[name] = content;
    return this;
  };
  JSZip.prototype.generateAsync = function(options) {
    return Promise.resolve(new Blob([]));
  };
  global.JSZip = JSZip;
})(window);
