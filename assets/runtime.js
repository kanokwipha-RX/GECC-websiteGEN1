/* Production is the default. Only the local preview server enables demo mode. */
window.GECC_SERVER = window.GECC_PREVIEW !== true;
window.GECC_BASE_PATH = new URL("../", document.currentScript.src).pathname;
