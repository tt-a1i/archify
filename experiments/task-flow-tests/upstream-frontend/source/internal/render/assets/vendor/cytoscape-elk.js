(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory(require("elkjs/lib/elk.bundled.js"));
	else if(typeof define === 'function' && define.amd)
		define(["elkjs"], factory);
	else if(typeof exports === 'object')
		exports["cytoscapeElk"] = factory(require("elkjs/lib/elk.bundled.js"));
	else
		root["cytoscapeElk"] = factory(root["ELK"]);
})(this, function(__WEBPACK_EXTERNAL_MODULE__632__) {
return /******/ (function() { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 632:
/***/ (function(module) {

module.exports = __WEBPACK_EXTERNAL_MODULE__632__;

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	!function() {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = function(module) {
/******/ 			var getter = module && module.__esModule ?
/******/ 				function() { return module['default']; } :
/******/ 				function() { return module; };
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	}();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	!function() {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = function(exports, definition) {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	}();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	!function() {
/******/ 		__webpack_require__.o = function(obj, prop) { return Object.prototype.hasOwnProperty.call(obj, prop); }
/******/ 	}();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
!function() {

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  "default": function() { return /* binding */ src; }
});

// EXTERNAL MODULE: external {"commonjs":"elkjs/lib/elk.bundled.js","commonjs2":"elkjs/lib/elk.bundled.js","amd":"elkjs","root":"ELK"}
var elk_bundled_js_amd_elkjs_root_ELK_ = __webpack_require__(632);
var elk_bundled_js_amd_elkjs_root_ELK_default = /*#__PURE__*/__webpack_require__.n(elk_bundled_js_amd_elkjs_root_ELK_);
;// CONCATENATED MODULE: ./src/assign.js
// Simple, internal Object.assign() polyfill for options objects etc.
function assign_assign(tgt) {
  for (var _len = arguments.length, srcs = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
    srcs[_key - 1] = arguments[_key];
  }

  srcs.forEach(function (src) {
    Object.keys(src).forEach(function (k) {
      return tgt[k] = src[k];
    });
  });
  return tgt;
}

/* harmony default export */ var src_assign = (Object.assign != null ? Object.assign.bind(Object) : assign_assign);
;// CONCATENATED MODULE: ./src/defaults.js
var defaults = {
  nodeDimensionsIncludeLabels: false,
  // Boolean which changes whether label dimensions are included when calculating node dimensions
  fit: true,
  // Whether to fit
  padding: 20,
  // Padding on fit
  animate: false,
  // Whether to transition the node positions
  animateFilter: function animateFilter() {
    return true;
  },
  // Whether to animate specific nodes when animation is on; non-animated nodes immediately go to their final positions
  animationDuration: 500,
  // Duration of animation in ms if enabled
  animationEasing: undefined,
  // Easing of animation if enabled
  transform: function transform(node, pos) {
    return pos;
  },
  // A function that applies a transform to the final node position
  ready: undefined,
  // Callback on layoutready
  stop: undefined,
  // Callback on layoutstop
  nodeLayoutOptions: undefined,
  // Special options for only the nodes
  elk: {
    // Options to pass directly to ELK `layoutOptions`. The subsequent identifier has to be used as property key in quotes.
    // E.g. for 'org.eclipse.elk.direction' use:
    // 'elk.direction'
    // Primary/mandatory, the elk algorithm to use
    // one of 'box', 'disco', 'force', 'layered', 'mrtree', 'radial', 'random', 'stress'
    // (see https://www.eclipse.org/elk/reference/algorithms.html)
    algorithm: undefined
  },
  priority: function priority() {
    return null;
  } // Edges with a non-nil value are skipped when geedy edge cycle breaking is enabled

};
/* harmony default export */ var src_defaults = (defaults);
;// CONCATENATED MODULE: ./src/layout.js
function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); Object.defineProperty(Constructor, "prototype", { writable: false }); return Constructor; }




var elkOverrides = {};

var getPos = function getPos(ele, options) {
  var dims = ele.layoutDimensions(options);
  var parent = ele.parent();
  var k = ele.scratch('elk');
  var p = {
    x: k.x,
    y: k.y
  };

  while (parent.nonempty()) {
    var kp = parent.scratch('elk');
    p.x += kp.x;
    p.y += kp.y;
    parent = parent.parent();
  } // elk considers a node position to be its top-left corner, while cy is the centre


  p.x += dims.w / 2;
  p.y += dims.h / 2;
  return p;
};

var makeNode = function makeNode(node, options) {
  var k = {
    _cyEle: node,
    id: node.id()
  }; // Apply nodeLayoutOptions per user-specified function
  // e.g. nodeLayoutOptions => n.scratch('layoutOptions')

  if (options.nodeLayoutOptions) {
    k.layoutOptions = options.nodeLayoutOptions(node);
  }

  if (!node.isParent()) {
    var dims = node.layoutDimensions(options);
    var p = node.position(); // the elk position is the top-left corner, cy is the centre

    k.x = p.x - dims.w / 2;
    k.y = p.y - dims.h / 2;
    k.width = dims.w;
    k.height = dims.h;
  }

  node.scratch('elk', k);
  return k;
};

var makeEdge = function makeEdge(edge
/*, options*/
) {
  var k = {
    _cyEle: edge,
    id: edge.id(),
    source: edge.data('source'),
    target: edge.data('target')
  };
  edge.scratch('elk', k);
  return k;
};

var makeGraph = function makeGraph(nodes, edges, options) {
  var elkNodes = [];
  var elkEdges = [];
  var elkEleLookup = {};
  var graph = {
    id: 'root',
    children: [],
    edges: []
  }; // map all nodes

  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    var k = makeNode(n, options);
    elkNodes.push(k);
    elkEleLookup[n.id()] = k;
  } // map all edges


  for (var _i = 0; _i < edges.length; _i++) {
    var e = edges[_i];

    var _k = makeEdge(e, options);

    elkEdges.push(_k);
    elkEleLookup[e.id()] = _k;
  } // make hierarchy


  for (var _i2 = 0; _i2 < elkNodes.length; _i2++) {
    var _k2 = elkNodes[_i2];
    var _n = _k2._cyEle;

    if (!_n.isChild()) {
      graph.children.push(_k2);
    } else {
      var parent = _n.parent();

      var parentK = elkEleLookup[parent.id()];
      var children = parentK.children = parentK.children || [];
      children.push(_k2);
    }
  }

  for (var _i3 = 0; _i3 < elkEdges.length; _i3++) {
    var _k3 = elkEdges[_i3]; // put all edges in the top level for now
    // TODO does this cause issues in certain edgecases?

    /*let e = k._cyEle;
    let parentSrc = e.source().parent();
    let parentTgt = e.target().parent();
    if ( false && parentSrc.nonempty() && parentTgt.nonempty() && parentSrc.same( parentTgt ) ){
      let kp = elkEleLookup[ parentSrc.id() ];
       kp.edges = kp.edges || [];
       kp.edges.push( k );
    } else {*/

    graph.edges.push(_k3); //}
  }

  return graph;
};

var Layout = /*#__PURE__*/function () {
  function Layout(options) {
    _classCallCheck(this, Layout);

    var elkOptions = options.elk;
    var cy = options.cy;
    this.options = src_assign({}, src_defaults, options);
    this.options.elk = src_assign({
      aspectRatio: cy.width() / cy.height()
    }, src_defaults.elk, elkOptions, elkOverrides);
  }

  _createClass(Layout, [{
    key: "run",
    value: function run() {
      var layout = this;
      var options = this.options;
      var eles = options.eles;
      var nodes = eles.nodes();
      var edges = eles.edges();
      var elk = new (elk_bundled_js_amd_elkjs_root_ELK_default())();
      var graph = makeGraph(nodes, edges, options);
      graph['layoutOptions'] = options.elk;
      elk.layout(graph).then(function () {
        nodes.filter(function (n) {
          return !n.isParent();
        }).layoutPositions(layout, options, function (n) {
          return getPos(n, options);
        });
      });
      return this;
    }
  }, {
    key: "stop",
    value: function stop() {
      return this; // chaining
    }
  }, {
    key: "destroy",
    value: function destroy() {
      return this; // chaining
    }
  }]);

  return Layout;
}();

/* harmony default export */ var layout = (Layout);
;// CONCATENATED MODULE: ./src/index.js
 // registers the extension on a cytoscape lib ref

var register = function register(cytoscape) {
  if (!cytoscape) {
    return;
  } // can't register if cytoscape unspecified


  cytoscape('layout', 'elk', layout); // register with cytoscape.js
};

if (typeof cytoscape !== 'undefined') {
  // expose to global cytoscape (i.e. window.cytoscape)
  // eslint-disable-next-line no-undef
  register(cytoscape);
}

/* harmony default export */ var src = (register);
}();
__webpack_exports__ = __webpack_exports__["default"];
/******/ 	return __webpack_exports__;
/******/ })()
;
});