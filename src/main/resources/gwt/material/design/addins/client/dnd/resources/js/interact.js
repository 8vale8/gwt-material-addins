/**
 * interact.js v1.2.6
 *
 * Copyright (c) 2012-2015 Taye Adeyemi <dev@taye.me>
 * Open source under the MIT License.
 * https://raw.github.com/taye/interact.js/master/LICENSE
 */
(function (realWindow) {
    'use strict';

    // return early if there's no window to work with (eg. Node.js)
    if (!realWindow) {
        return;
    }

    var // get wrapped window if using Shadow DOM polyfill
        window = (function () {
            // create a TextNode
            var el = realWindow.document.createTextNode('');

            // check if it's wrapped by a polyfill
            if (el.ownerDocument !== realWindow.document
                && typeof realWindow.wrap === 'function'
                && realWindow.wrap(el) === el) {
                // return wrapped window
                return realWindow.wrap(realWindow);
            }

            // no Shadow DOM polyfil or native implementation
            return realWindow;
        }()),

        document = window.document,
        DocumentFragment = window.DocumentFragment || blank,
        SVGElement = window.SVGElement || blank,
        SVGSVGElement = window.SVGSVGElement || blank,
        SVGElementInstance = window.SVGElementInstance || blank,
        HTMLElement = window.HTMLElement || window.Element,

        PointerEvent = (window.PointerEvent || window.MSPointerEvent),
        pEventTypes,

        hypot = Math.hypot || function (x, y) {
                return Math.sqrt(x * x + y * y);
            },

        tmpXY = {},     // reduce object creation in getXY()

        documents = [],   // all documents being listened to

        interactables = [],   // all set interactables
        interactions = [],   // all interactions

        dynamicDrop = false,

    // {
    //      type: {
    //          selectors: ['selector', ...],
    //          contexts : [document, ...],
    //          listeners: [[listener, useCapture], ...]
    //      }
    //  }
        delegatedEvents = {},

        defaultOptions = {
            base: {
                accept: null,
                actionChecker: null,
                styleCursor: true,
                preventDefault: 'auto',
                origin: {x: 0, y: 0},
                deltaSource: 'page',
                allowFrom: null,
                ignoreFrom: null,
                _context: document,
                dropChecker: null
            },

            drag: {
                enabled: false,
                manualStart: true,
                max: Infinity,
                maxPerElement: 1,

                snap: null,
                restrict: null,
                inertia: null,
                autoScroll: null,

                axis: 'xy'
            },

            drop: {
                enabled: false,
                accept: null,
                overlap: 'pointer'
            },

            resize: {
                enabled: false,
                manualStart: false,
                max: Infinity,
                maxPerElement: 1,

                snap: null,
                restrict: null,
                inertia: null,
                autoScroll: null,

                square: false,
                preserveAspectRatio: false,
                axis: 'xy',

                // use default margin
                margin: NaN,

                // object with props left, right, top, bottom which are
                // true/false values to resize when the pointer is over that edge,
                // CSS selectors to match the handles for each direction
                // or the Elements for each handle
                edges: null,

                // a value of 'none' will limit the resize rect to a minimum of 0x0
                // 'negate' will alow the rect to have negative width/height
                // 'reposition' will keep the width/height positive by swapping
                // the top and bottom edges and/or swapping the left and right edges
                invert: 'none'
            },

            gesture: {
                manualStart: false,
                enabled: false,
                max: Infinity,
                maxPerElement: 1,

                restrict: null
            },

            perAction: {
                manualStart: false,
                max: Infinity,
                maxPerElement: 1,

                snap: {
                    enabled: false,
                    endOnly: false,
                    range: Infinity,
                    targets: null,
                    offsets: null,

                    relativePoints: null
                },

                restrict: {
                    enabled: false,
                    endOnly: false
                },

                autoScroll: {
                    enabled: false,
                    container: null,     // the item that is scrolled (Window or HTMLElement)
                    margin: 60,
                    speed: 300       // the scroll speed in pixels per second
                },

                inertia: {
                    enabled: false,
                    resistance: 10,    // the lambda in exponential decay
                    minSpeed: 100,   // target speed must be above this for inertia to start
                    endSpeed: 10,    // the speed at which inertia is slow enough to stop
                    allowResume: true,  // allow resuming an action in inertia phase
                    zeroResumeDelta: true,  // if an action is resumed after launch, set dx/dy to 0
                    smoothEndDuration: 300    // animate to snap/restrict endOnly if there's no inertia
                }
            },

            _holdDuration: 600
        },

    // Things related to autoScroll
        autoScroll = {
            interaction: null,
            i: null,    // the handle returned by window.setInterval
            x: 0, y: 0, // Direction each pulse is to scroll in

            // scroll the window by the values in scroll.x/y
            scroll: function () {
                var options = autoScroll.interaction.target.options[autoScroll.interaction.prepared.name].autoScroll,
                    container = options.container || getWindow(autoScroll.interaction.element),
                    now = new Date().getTime(),
                // change in time in seconds
                    dtx = (now - autoScroll.prevTimeX) / 1000,
                    dty = (now - autoScroll.prevTimeY) / 1000,
                    vx, vy, sx, sy;

                // displacement
                if (options.velocity) {
                    vx = options.velocity.x;
                    vy = options.velocity.y;
                }
                else {
                    vx = vy = options.speed
                }

                sx = vx * dtx;
                sy = vy * dty;

                if (sx >= 1 || sy >= 1) {
                    if (isWindow(container)) {
                        container.scrollBy(autoScroll.x * sx, autoScroll.y * sy);
                    }
                    else if (container) {
                        container.scrollLeft += autoScroll.x * sx;
                        container.scrollTop += autoScroll.y * sy;
                    }

                    if (sx >= 1) autoScroll.prevTimeX = now;
                    if (sy >= 1) autoScroll.prevTimeY = now;
                }

                if (autoScroll.isScrolling) {
                    cancelFrame(autoScroll.i);
                    autoScroll.i = reqFrame(autoScroll.scroll);
                }
            },

            isScrolling: false,
            prevTimeX: 0,
            prevTimeY: 0,

            start: function (interaction) {
                autoScroll.isScrolling = true;
                cancelFrame(autoScroll.i);

                autoScroll.interaction = interaction;
                autoScroll.prevTimeX = new Date().getTime();
                autoScroll.prevTimeY = new Date().getTime();
                autoScroll.i = reqFrame(autoScroll.scroll);
            },

            stop: function () {
                autoScroll.isScrolling = false;
                cancelFrame(autoScroll.i);
            }
        },

    // Does the browser support touch input?
        supportsTouch = (('ontouchstart' in window) || window.DocumentTouch && document instanceof window.DocumentTouch),

    // Does the browser support PointerEvents
        supportsPointerEvent = !!PointerEvent,

    // Less Precision with touch input
        margin = supportsTouch || supportsPointerEvent ? 20 : 10,

        pointerMoveTolerance = 1,

    // for ignoring browser's simulated mouse events
        prevTouchTime = 0,

    // Allow this many interactions to happen simultaneously
        maxInteractions = Infinity,

    // Check if is IE9 or older
        actionCursors = (document.all && !window.atob) ? {
            drag: 'move',
            resizex: 'e-resize',
            resizey: 's-resize',
            resizexy: 'se-resize',

            resizetop: 'n-resize',
            resizeleft: 'w-resize',
            resizebottom: 's-resize',
            resizeright: 'e-resize',
            resizetopleft: 'se-resize',
            resizebottomright: 'se-resize',
            resizetopright: 'ne-resize',
            resizebottomleft: 'ne-resize',

            gesture: ''
        } : {
            drag: 'move',
            resizex: 'ew-resize',
            resizey: 'ns-resize',
            resizexy: 'nwse-resize',

            resizetop: 'ns-resize',
            resizeleft: 'ew-resize',
            resizebottom: 'ns-resize',
            resizeright: 'ew-resize',
            resizetopleft: 'nwse-resize',
            resizebottomright: 'nwse-resize',
            resizetopright: 'nesw-resize',
            resizebottomleft: 'nesw-resize',

            gesture: ''
        },

        actionIsEnabled = {
            drag: true,
            resize: true,
            gesture: true
        },

    // because Webkit and Opera still use 'mousewheel' event type
        wheelEvent = 'onmousewheel' in document ? 'mousewheel' : 'wheel',

        eventTypes = [
            'dragstart',
            'dragmove',
            'draginertiastart',
            'dragend',
            'dragenter',
            'dragleave',
            'dropactivate',
            'dropdeactivate',
            'dropmove',
            'drop',
            'resizestart',
            'resizemove',
            'resizeinertiastart',
            'resizeend',
            'gesturestart',
            'gesturemove',
            'gestureinertiastart',
            'gestureend',

            'down',
            'move',
            'up',
            'cancel',
            'tap',
            'doubletap',
            'hold'
        ],

        globalEvents = {},

    // Opera Mobile must be handled differently
        isOperaMobile = navigator.appName == 'Opera' &&
            supportsTouch &&
            navigator.userAgent.match('Presto'),

    // scrolling doesn't change the result of getClientRects on iOS 7
        isIOS7 = (/iP(hone|od|ad)/.test(navigator.platform)
        && /OS 7[^\d]/.test(navigator.appVersion)),

    // prefix matchesSelector
        prefixedMatchesSelector = 'matches' in Element.prototype ?
            'matches' : 'webkitMatchesSelector' in Element.prototype ?
            'webkitMatchesSelector' : 'mozMatchesSelector' in Element.prototype ?
            'mozMatchesSelector' : 'oMatchesSelector' in Element.prototype ?
            'oMatchesSelector' : 'msMatchesSelector',

    // will be polyfill function if browser is IE8
        ie8MatchesSelector,

    // native requestAnimationFrame or polyfill
        reqFrame = realWindow.requestAnimationFrame,
        cancelFrame = realWindow.cancelAnimationFrame,

    // Events wrapper
        events = (function () {
            var useAttachEvent = ('attachEvent' in window) && !('addEventListener' in window),
                addEvent = useAttachEvent ? 'attachEvent' : 'addEventListener',
                removeEvent = useAttachEvent ? 'detachEvent' : 'removeEventListener',
                on = useAttachEvent ? 'on' : '',

                elements = [],
                targets = [],
                attachedListeners = [];

            function add(element, type, listener, useCapture) {
                var elementIndex = indexOf(elements, element),
                    target = targets[elementIndex];

                if (!target) {
                    target = {
                        events: {},
                        typeCount: 0
                    };

                    elementIndex = elements.push(element) - 1;
                    targets.push(target);

                    attachedListeners.push((useAttachEvent ? {
                        supplied: [],
                        wrapped: [],
                        useCount: []
                    } : null));
                }

                if (!target.events[type]) {
                    target.events[type] = [];
                    target.typeCount++;
                }

                if (!contains(target.events[type], listener)) {
                    var ret;

                    if (useAttachEvent) {
                        var listeners = attachedListeners[elementIndex],
                            listenerIndex = indexOf(listeners.supplied, listener);

                        var wrapped = listeners.wrapped[listenerIndex] || function (event) {
                                if (!event.immediatePropagationStopped) {
                                    event.target = event.srcElement;
                                    event.currentTarget = element;

                                    event.preventDefault = event.preventDefault || preventDef;
                                    event.stopPropagation = event.stopPropagation || stopProp;
                                    event.stopImmediatePropagation = event.stopImmediatePropagation || stopImmProp;

                                    if (/mouse|click/.test(event.type)) {
                                        event.pageX = event.clientX + getWindow(element).document.documentElement.scrollLeft;
                                        event.pageY = event.clientY + getWindow(element).document.documentElement.scrollTop;
                                    }

                                    listener(event);
                                }
                            };

                        ret = element[addEvent](on + type, wrapped, Boolean(useCapture));

                        if (listenerIndex === -1) {
                            listeners.supplied.push(listener);
                            listeners.wrapped.push(wrapped);
                            listeners.useCount.push(1);
                        }
                        else {
                            listeners.useCount[listenerIndex]++;
                        }
                    }
                    else {
                        ret = element[addEvent](type, listener, useCapture || false);
                    }
                    target.events[type].push(listener);

                    return ret;
                }
            }

            function remove(element, type, listener, useCapture) {
                var i,
                    elementIndex = indexOf(elements, element),
                    target = targets[elementIndex],
                    listeners,
                    listenerIndex,
                    wrapped = listener;

                if (!target || !target.events) {
                    return;
                }

                if (useAttachEvent) {
                    listeners = attachedListeners[elementIndex];
                    listenerIndex = indexOf(listeners.supplied, listener);
                    wrapped = listeners.wrapped[listenerIndex];
                }

                if (type === 'all') {
                    for (type in target.events) {
                        if (target.events.hasOwnProperty(type)) {
                            remove(element, type, 'all');
                        }
                    }
                    return;
                }

                if (target.events[type]) {
                    var len = target.events[type].length;

                    if (listener === 'all') {
                        for (i = 0; i < len; i++) {
                            remove(element, type, target.events[type][i], Boolean(useCapture));
                        }
                        return;
                    } else {
                        for (i = 0; i < len; i++) {
                            if (target.events[type][i] === listener) {
                                element[removeEvent](on + type, wrapped, useCapture || false);
                                target.events[type].splice(i, 1);

                                if (useAttachEvent && listeners) {
                                    listeners.useCount[listenerIndex]--;
                                    if (listeners.useCount[listenerIndex] === 0) {
                                        listeners.supplied.splice(listenerIndex, 1);
                                        listeners.wrapped.splice(listenerIndex, 1);
                                        listeners.useCount.splice(listenerIndex, 1);
                                    }
                                }

                                break;
                            }
                        }
                    }

                    if (target.events[type] && target.events[type].length === 0) {
                        target.events[type] = null;
                        target.typeCount--;
                    }
                }

                if (!target.typeCount) {
                    targets.splice(elementIndex, 1);
                    elements.splice(elementIndex, 1);
                    attachedListeners.splice(elementIndex, 1);
                }
            }

            function preventDef() {
                this.returnValue = false;
            }

            function stopProp() {
                this.cancelBubble = true;
            }

            function stopImmProp() {
                this.cancelBubble = true;
                this.immediatePropagationStopped = true;
            }

            return {
                add: add,
                remove: remove,
                useAttachEvent: useAttachEvent,

                _elements: elements,
                _targets: targets,
                _attachedListeners: attachedListeners
            };
        }());

    function blank() {
    }

    function isElement(o) {
        if (!o || (typeof o !== 'object')) {
            return false;
        }

        var _window = getWindow(o) || window;

        return (/object|function/.test(typeof _window.Element)
            ? o instanceof _window.Element //DOM2
            : o.nodeType === 1 && typeof o.nodeName === "string");
    }

    function isWindow(thing) {
        return thing === window || !!(thing && thing.Window) && (thing instanceof thing.Window);
    }

    function isDocFrag(thing) {
        return !!thing && thing instanceof DocumentFragment;
    }

    function isArray(thing) {
        return isObject(thing)
            && (typeof thing.length !== undefined)
            && isFunction(thing.splice);
    }

    function isObject(thing) {
        return !!thing && (typeof thing === 'object');
    }

    function isFunction(thing) {
        return typeof thing === 'function';
    }

    function isNumber(thing) {
        return typeof thing === 'number';
    }

    function isBool(thing) {
        return typeof thing === 'boolean';
    }

    function isString(thing) {
        return typeof thing === 'string';
    }

    function trySelector(value) {
        if (!isString(value)) {
            return false;
        }

        // an exception will be raised if it is invalid
        document.querySelector(value);
        return true;
    }

    function extend(dest, source) {
        for (var prop in source) {
            dest[prop] = source[prop];
        }
        return dest;
    }

    var prefixedPropREs = {
        webkit: /(Movement[XY]|Radius[XY]|RotationAngle|Force)$/
    };

    function pointerExtend(dest, source) {
        for (var prop in source) {
            var deprecated = false;

            // skip deprecated prefixed properties
            for (var vendor in prefixedPropREs) {
                if (prop.indexOf(vendor) === 0 && prefixedPropREs[vendor].test(prop)) {
                    deprecated = true;
                    break;
                }
            }

            if (!deprecated) {
                dest[prop] = source[prop];
            }
        }
        return dest;
    }

    function copyCoords(dest, src) {
        dest.page = dest.page || {};
        dest.page.x = src.page.x;
        dest.page.y = src.page.y;

        dest.client = dest.client || {};
        dest.client.x = src.client.x;
        dest.client.y = src.client.y;

        dest.timeStamp = src.timeStamp;
    }

    function setEventXY(targetObj, pointers, interaction) {
        var pointer = (pointers.length > 1
            ? pointerAverage(pointers)
            : pointers[0]);

        getPageXY(pointer, tmpXY, interaction);
        targetObj.page.x = tmpXY.x;
        targetObj.page.y = tmpXY.y;

        getClientXY(pointer, tmpXY, interaction);
        targetObj.client.x = tmpXY.x;
        targetObj.client.y = tmpXY.y;

        targetObj.timeStamp = new Date().getTime();
    }

    function setEventDeltas(targetObj, prev, cur) {
        targetObj.page.x = cur.page.x - prev.page.x;
        targetObj.page.y = cur.page.y - prev.page.y;
        targetObj.client.x = cur.client.x - prev.client.x;
        targetObj.client.y = cur.client.y - prev.client.y;
        targetObj.timeStamp = new Date().getTime() - prev.timeStamp;

        // set pointer velocity
        var dt = Math.max(targetObj.timeStamp / 1000, 0.001);
        targetObj.page.speed = hypot(targetObj.page.x, targetObj.page.y) / dt;
        targetObj.page.vx = targetObj.page.x / dt;
        targetObj.page.vy = targetObj.page.y / dt;

        targetObj.client.speed = hypot(targetObj.client.x, targetObj.page.y) / dt;
        targetObj.client.vx = targetObj.client.x / dt;
        targetObj.client.vy = targetObj.client.y / dt;
    }

    function isNativePointer(pointer) {
        return (pointer instanceof window.Event
        || (supportsTouch && window.Touch && pointer instanceof window.Touch));
    }

    // Get specified X/Y coords for mouse or event.touches[0]
    function getXY(type, pointer, xy) {
        xy = xy || {};
        type = type || 'page';

        xy.x = pointer[type + 'X'];
        xy.y = pointer[type + 'Y'];

        return xy;
    }

    function getPageXY(pointer, page) {
        page = page || {};

        // Opera Mobile handles the viewport and scrolling oddly
        if (isOperaMobile && isNativePointer(pointer)) {
            getXY('screen', pointer, page);

            page.x += window.scrollX;
            page.y += window.scrollY;
        }
        else {
            getXY('page', pointer, page);
        }

        return page;
    }

    function getClientXY(pointer, client) {
        client = client || {};

        if (isOperaMobile && isNativePointer(pointer)) {
            // Opera Mobile handles the viewport and scrolling oddly
            getXY('screen', pointer, client);
        }
        else {
            getXY('client', pointer, client);
        }

        return client;
    }

    function getScrollXY(win) {
        win = win || window;
        return {
            x: win.scrollX || win.document.documentElement.scrollLeft,
            y: win.scrollY || win.document.documentElement.scrollTop
        };
    }

    function getPointerId(pointer) {
        return isNumber(pointer.pointerId) ? pointer.pointerId : pointer.identifier;
    }

    function getActualElement(element) {
        return (element instanceof SVGElementInstance
            ? element.correspondingUseElement
            : element);
    }

    function getWindow(node) {
        if (isWindow(node)) {
            return node;
        }

        var rootNode = (node.ownerDocument || node);

        return rootNode.defaultView || rootNode.parentWindow || window;
    }

    function getElementClientRect(element) {
        var clientRect = (element instanceof SVGElement
            ? element.getBoundingClientRect()
            : element.getClientRects()[0]);

        return clientRect && {
                left: clientRect.left,
                right: clientRect.right,
                top: clientRect.top,
                bottom: clientRect.bottom,
                width: clientRect.width || clientRect.right - clientRect.left,
                height: clientRect.height || clientRect.bottom - clientRect.top
            };
    }

    function getElementRect(element) {
        var clientRect = getElementClientRect(element);

        if (!isIOS7 && clientRect) {
            var scroll = getScrollXY(getWindow(element));

            clientRect.left += scroll.x;
            clientRect.right += scroll.x;
            clientRect.top += scroll.y;
            clientRect.bottom += scroll.y;
        }

        return clientRect;
    }

    function getTouchPair(event) {
        var touches = [];

        // array of touches is supplied
        if (isArray(event)) {
            touches[0] = event[0];
            touches[1] = event[1];
        }
        // an event
        else {
            if (event.type === 'touchend') {
                if (event.touches.length === 1) {
                    touches[0] = event.touches[0];
                    touches[1] = event.changedTouches[0];
                }
                else if (event.touches.length === 0) {
                    touches[0] = event.changedTouches[0];
                    touches[1] = event.changedTouches[1];
                }
            }
            else {
                touches[0] = event.touches[0];
                touches[1] = event.touches[1];
            }
        }

        return touches;
    }

    function pointerAverage(pointers) {
        var average = {
            pageX: 0,
            pageY: 0,
            clientX: 0,
            clientY: 0,
            screenX: 0,
            screenY: 0
        };
        var prop;

        for (var i = 0; i < pointers.length; i++) {
            for (prop in average) {
                average[prop] += pointers[i][prop];
            }
        }
        for (prop in average) {
            average[prop] /= pointers.length;
        }

        return average;
    }

    function touchBBox(event) {
        if (!event.length && !(event.touches && event.touches.length > 1)) {
            return;
        }

        var touches = getTouchPair(event),
            minX = Math.min(touches[0].pageX, touches[1].pageX),
            minY = Math.min(touches[0].pageY, touches[1].pageY),
            maxX = Math.max(touches[0].pageX, touches[1].pageX),
            maxY = Math.max(touches[0].pageY, touches[1].pageY);

        return {
            x: minX,
            y: minY,
            left: minX,
            top: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    function touchDistance(event, deltaSource) {
        deltaSource = deltaSource || defaultOptions.deltaSource;

        var sourceX = deltaSource + 'X',
            sourceY = deltaSource + 'Y',
            touches = getTouchPair(event);


        var dx = touches[0][sourceX] - touches[1][sourceX],
            dy = touches[0][sourceY] - touches[1][sourceY];

        return hypot(dx, dy);
    }

    function touchAngle(event, prevAngle, deltaSource) {
        deltaSource = deltaSource || defaultOptions.deltaSource;

        var sourceX = deltaSource + 'X',
            sourceY = deltaSource + 'Y',
            touches = getTouchPair(event),
            dx = touches[0][sourceX] - touches[1][sourceX],
            dy = touches[0][sourceY] - touches[1][sourceY],
            angle = 180 * Math.atan(dy / dx) / Math.PI;

        if (isNumber(prevAngle)) {
            var dr = angle - prevAngle,
                drClamped = dr % 360;

            if (drClamped > 315) {
                angle -= 360 + (angle / 360) | 0 * 360;
            }
            else if (drClamped > 135) {
                angle -= 180 + (angle / 360) | 0 * 360;
            }
            else if (drClamped < -315) {
                angle += 360 + (angle / 360) | 0 * 360;
            }
            else if (drClamped < -135) {
                angle += 180 + (angle / 360) | 0 * 360;
            }
        }

        return angle;
    }

    function getOriginXY(interactable, element) {
        var origin = interactable
            ? interactable.options.origin
            : defaultOptions.origin;

        if (origin === 'parent') {
            origin = parentElement(element);
        }
        else if (origin === 'self') {
            origin = interactable.getRect(element);
        }
        else if (trySelector(origin)) {
            origin = closest(element, origin) || {x: 0, y: 0};
        }

        if (isFunction(origin)) {
            origin = origin(interactable && element);
        }

        if (isElement(origin)) {
            origin = getElementRect(origin);
        }

        origin.x = ('x' in origin) ? origin.x : origin.left;
        origin.y = ('y' in origin) ? origin.y : origin.top;

        return origin;
    }

    // http://stackoverflow.com/a/5634528/2280888
    function _getQBezierValue(t, p1, p2, p3) {
        var iT = 1 - t;
        return iT * iT * p1 + 2 * iT * t * p2 + t * t * p3;
    }

    function getQuadraticCurvePoint(startX, startY, cpX, cpY, endX, endY, position) {
        return {
            x: _getQBezierValue(position, startX, cpX, endX),
            y: _getQBezierValue(position, startY, cpY, endY)
        };
    }

    // http://gizma.com/easing/
    function easeOutQuad(t, b, c, d) {
        t /= d;
        return -c * t * (t - 2) + b;
    }

    function nodeContains(parent, child) {
        while (child) {
            if (child === parent) {
                return true;
            }

            child = child.parentNode;
        }

        return false;
    }

    function closest(child, selector) {
        var parent = parentElement(child);

        while (isElement(parent)) {
            if (matchesSelector(parent, selector)) {
                return parent;
            }

            parent = parentElement(parent);
        }

        return null;
    }

    function parentElement(node) {
        var parent = node.parentNode;

        if (isDocFrag(parent)) {
            // skip past #shado-root fragments
            while ((parent = parent.host) && isDocFrag(parent)) {
            }

            return parent;
        }

        return parent;
    }

    function inContext(interactable, element) {
        return interactable._context === element.ownerDocument
            || nodeContains(interactable._context, element);
    }

    function testIgnore(interactable, interactableElement, element) {
        var ignoreFrom = interactable.options.ignoreFrom;

        if (!ignoreFrom || !isElement(element)) {
            return false;
        }

        if (isString(ignoreFrom)) {
            return matchesUpTo(element, ignoreFrom, interactableElement);
        }
        else if (isElement(ignoreFrom)) {
            return nodeContains(ignoreFrom, element);
        }

        return false;
    }

    function testAllow(interactable, interactableElement, element) {
        var allowFrom = interactable.options.allowFrom;

        if (!allowFrom) {
            return true;
        }

        if (!isElement(element)) {
            return false;
        }

        if (isString(allowFrom)) {
            return matchesUpTo(element, allowFrom, interactableElement);
        }
        else if (isElement(allowFrom)) {
            return nodeContains(allowFrom, element);
        }

        return false;
    }

    function checkAxis(axis, interactable) {
        if (!interactable) {
            return false;
        }

        var thisAxis = interactable.options.drag.axis;

        return (axis === 'xy' || thisAxis === 'xy' || thisAxis === axis);
    }

    function checkSnap(interactable, action) {
        var options = interactable.options;

        if (/^resize/.test(action)) {
            action = 'resize';
        }

        return options[action].snap && options[action].snap.enabled;
    }

    function checkRestrict(interactable, action) {
        var options = interactable.options;

        if (/^resize/.test(action)) {
            action = 'resize';
        }

        return options[action].restrict && options[action].restrict.enabled;
    }

    function checkAutoScroll(interactable, action) {
        var options = interactable.options;

        if (/^resize/.test(action)) {
            action = 'resize';
        }

        return options[action].autoScroll && options[action].autoScroll.enabled;
    }

    function withinInteractionLimit(interactable, element, action) {
        var options = interactable.options,
            maxActions = options[action.name].max,
            maxPerElement = options[action.name].maxPerElement,
            activeInteractions = 0,
            targetCount = 0,
            targetElementCount = 0;

        for (var i = 0, len = interactions.length; i < len; i++) {
            var interaction = interactions[i],
                otherAction = interaction.prepared.name,
                active = interaction.interacting();

            if (!active) {
                continue;
            }

            activeInteractions++;

            if (activeInteractions >= maxInteractions) {
                return false;
            }

            if (interaction.target !== interactable) {
                continue;
            }

            targetCount += (otherAction === action.name) | 0;

            if (targetCount >= maxActions) {
                return false;
            }

            if (interaction.element === element) {
                targetElementCount++;

                if (otherAction !== action.name || targetElementCount >= maxPerElement) {
                    return false;
                }
            }
        }

        return maxInteractions > 0;
    }

    // Test for the element that's "above" all other qualifiers
    function indexOfDeepestElement(elements) {
        var dropzone,
            deepestZone = elements[0],
            index = deepestZone ? 0 : -1,
            parent,
            deepestZoneParents = [],
            dropzoneParents = [],
            child,
            i,
            n;

        for (i = 1; i < elements.length; i++) {
            dropzone = elements[i];

            // an element might belong to multiple selector dropzones
            if (!dropzone || dropzone === deepestZone) {
                continue;
            }

            if (!deepestZone) {
                deepestZone = dropzone;
                index = i;
                continue;
            }

            // check if the deepest or current are document.documentElement or document.rootElement
            // - if the current dropzone is, do nothing and continue
            if (dropzone.parentNode === dropzone.ownerDocument) {
                continue;
            }
            // - if deepest is, update with the current dropzone and continue to next
            else if (deepestZone.parentNode === dropzone.ownerDocument) {
                deepestZone = dropzone;
                index = i;
                continue;
            }

            if (!deepestZoneParents.length) {
                parent = deepestZone;
                while (parent.parentNode && parent.parentNode !== parent.ownerDocument) {
                    deepestZoneParents.unshift(parent);
                    parent = parent.parentNode;
                }
            }

            // if this element is an svg element and the current deepest is
            // an HTMLElement
            if (deepestZone instanceof HTMLElement
                && dropzone instanceof SVGElement
                && !(dropzone instanceof SVGSVGElement)) {

                if (dropzone === deepestZone.parentNode) {
                    continue;
                }

                parent = dropzone.ownerSVGElement;
            }
            else {
                parent = dropzone;
            }

            dropzoneParents = [];

            while (parent.parentNode !== parent.ownerDocument) {
                dropzoneParents.unshift(parent);
                parent = parent.parentNode;
            }

            n = 0;

            // get (position of last common ancestor) + 1
            while (dropzoneParents[n] && dropzoneParents[n] === deepestZoneParents[n]) {
                n++;
            }

            var parents = [
                dropzoneParents[n - 1],
                dropzoneParents[n],
                deepestZoneParents[n]
            ];

            child = parents[0].lastChild;

            while (child) {
                if (child === parents[1]) {
                    deepestZone = dropzone;
                    index = i;
                    deepestZoneParents = [];

                    break;
                }
                else if (child === parents[2]) {
                    break;
                }

                child = child.previousSibling;
            }
        }

        return index;
    }

    function Interaction() {
        this.target = null; // current interactable being interacted with
        this.element = null; // the target element of the interactable
        this.dropTarget = null; // the dropzone a drag target might be dropped into
        this.dropElement = null; // the element at the time of checking
        this.prevDropTarget = null; // the dropzone that was recently dragged away from
        this.prevDropElement = null; // the element at the time of checking

        this.prepared = {     // action that's ready to be fired on next move event
            name: null,
            axis: null,
            edges: null
        };

        this.matches = [];   // all selectors that are matched by target element
        this.matchElements = [];   // corresponding elements

        this.inertiaStatus = {
            active: false,
            smoothEnd: false,
            ending: false,

            startEvent: null,
            upCoords: {},

            xe: 0, ye: 0,
            sx: 0, sy: 0,

            t0: 0,
            vx0: 0, vys: 0,
            duration: 0,

            resumeDx: 0,
            resumeDy: 0,

            lambda_v0: 0,
            one_ve_v0: 0,
            i: null
        };

        if (isFunction(Function.prototype.bind)) {
            this.boundInertiaFrame = this.inertiaFrame.bind(this);
            this.boundSmoothEndFrame = this.smoothEndFrame.bind(this);
        }
        else {
            var that = this;

            this.boundInertiaFrame = function () {
                return that.inertiaFrame();
            };
            this.boundSmoothEndFrame = function () {
                return that.smoothEndFrame();
            };
        }

        this.activeDrops = {
            dropzones: [],      // the dropzones that are mentioned below
            elements: [],      // elements of dropzones that accept the target draggable
            rects: []       // the rects of the elements mentioned above
        };

        // keep track of added pointers
        this.pointers = [];
        this.pointerIds = [];
        this.downTargets = [];
        this.downTimes = [];
        this.holdTimers = [];

        // Previous native pointer move event coordinates
        this.prevCoords = {
            page: {x: 0, y: 0},
            client: {x: 0, y: 0},
            timeStamp: 0
        };
        // current native pointer move event coordinates
        this.curCoords = {
            page: {x: 0, y: 0},
            client: {x: 0, y: 0},
            timeStamp: 0
        };

        // Starting InteractEvent pointer coordinates
        this.startCoords = {
            page: {x: 0, y: 0},
            client: {x: 0, y: 0},
            timeStamp: 0
        };

        // Change in coordinates and time of the pointer
        this.pointerDelta = {
            page: {x: 0, y: 0, vx: 0, vy: 0, speed: 0},
            client: {x: 0, y: 0, vx: 0, vy: 0, speed: 0},
            timeStamp: 0
        };

        this.downEvent = null;    // pointerdown/mousedown/touchstart event
        this.downPointer = {};

        this._eventTarget = null;
        this._curEventTarget = null;

        this.prevEvent = null;      // previous action event
        this.tapTime = 0;         // time of the most recent tap event
        this.prevTap = null;

        this.startOffset = {left: 0, right: 0, top: 0, bottom: 0};
        this.restrictOffset = {left: 0, right: 0, top: 0, bottom: 0};
        this.snapOffsets = [];

        this.gesture = {
            start: {x: 0, y: 0},

            startDistance: 0,   // distance between two touches of touchStart
            prevDistance: 0,
            distance: 0,

            scale: 1,           // gesture.distance / gesture.startDistance

            startAngle: 0,      // angle of line joining two touches
            prevAngle: 0       // angle of the previous gesture event
        };

        this.snapStatus = {
            x: 0, y: 0,
            dx: 0, dy: 0,
            realX: 0, realY: 0,
            snappedX: 0, snappedY: 0,
            targets: [],
            locked: false,
            changed: false
        };

        this.restrictStatus = {
            dx: 0, dy: 0,
            restrictedX: 0, restrictedY: 0,
            snap: null,
            restricted: false,
            changed: false
        };

        this.restrictStatus.snap = this.snapStatus;

        this.pointerIsDown = false;
        this.pointerWasMoved = false;
        this.gesturing = false;
        this.dragging = false;
        this.resizing = false;
        this.resizeAxes = 'xy';

        this.mouse = false;

        interactions.push(this);
    }

    Interaction.prototype = {
        getPageXY: function (pointer, xy) {
            return getPageXY(pointer, xy, this);
        },
        getClientXY: function (pointer, xy) {
            return getClientXY(pointer, xy, this);
        },
        setEventXY: function (target, ptr) {
            return setEventXY(target, ptr, this);
        },

        pointerOver: function (pointer, event, eventTarget) {
            if (this.prepared.name || !this.mouse) {
                return;
            }

            var curMatches = [],
                curMatchElements = [],
                prevTargetElement = this.element;

            this.addPointer(pointer);

            if (this.target
                && (testIgnore(this.target, this.element, eventTarget)
                || !testAllow(this.target, this.element, eventTarget))) {
                // if the eventTarget should be ignored or shouldn't be allowed
                // clear the previous target
                this.target = null;
                this.element = null;
                this.matches = [];
                this.matchElements = [];
            }

            var elementInteractable = interactables.get(eventTarget),
                elementAction = (elementInteractable
                && !testIgnore(elementInteractable, eventTarget, eventTarget)
                && testAllow(elementInteractable, eventTarget, eventTarget)
                && validateAction(
                    elementInteractable.getAction(pointer, event, this, eventTarget),
                    elementInteractable));

            if (elementAction && !withinInteractionLimit(elementInteractable, eventTarget, elementAction)) {
                elementAction = null;
            }

            function pushCurMatches(interactable, selector) {
                if (interactable
                    && inContext(interactable, eventTarget)
                    && !testIgnore(interactable, eventTarget, eventTarget)
                    && testAllow(interactable, eventTarget, eventTarget)
                    && matchesSelector(eventTarget, selector)) {

                    curMatches.push(interactable);
                    curMatchElements.push(eventTarget);
                }
            }

            if (elementAction) {
                this.target = elementInteractable;
                this.element = eventTarget;
                this.matches = [];
                this.matchElements = [];
            }
            else {
                interactables.forEachSelector(pushCurMatches);

                if (this.validateSelector(pointer, event, curMatches, curMatchElements)) {
                    this.matches = curMatches;
                    this.matchElements = curMatchElements;

                    this.pointerHover(pointer, event, this.matches, this.matchElements);
                    events.add(eventTarget,
                        PointerEvent ? pEventTypes.move : 'mousemove',
                        listeners.pointerHover);
                }
                else if (this.target) {
                    if (nodeContains(prevTargetElement, eventTarget)) {
                        this.pointerHover(pointer, event, this.matches, this.matchElements);
                        events.add(this.element,
                            PointerEvent ? pEventTypes.move : 'mousemove',
                            listeners.pointerHover);
                    }
                    else {
                        this.target = null;
                        this.element = null;
                        this.matches = [];
                        this.matchElements = [];
                    }
                }
            }
        },

        // Check what action would be performed on pointerMove target if a mouse
        // button were pressed and change the cursor accordingly
        pointerHover: function (pointer, event, eventTarget, curEventTarget, matches, matchElements) {
            var target = this.target;

            if (!this.prepared.name && this.mouse) {

                var action;

                // update pointer coords for defaultActionChecker to use
                this.setEventXY(this.curCoords, [pointer]);

                if (matches) {
                    action = this.validateSelector(pointer, event, matches, matchElements);
                }
                else if (target) {
                    action = validateAction(target.getAction(this.pointers[0], event, this, this.element), this.target);
                }

                if (target && target.options.styleCursor) {
                    if (action) {
                        target._doc.documentElement.style.cursor = getActionCursor(action);
                    }
                    else {
                        target._doc.documentElement.style.cursor = '';
                    }
                }
            }
            else if (this.prepared.name) {
                this.checkAndPreventDefault(event, target, this.element);
            }
        },

        pointerOut: function (pointer, event, eventTarget) {
            if (this.prepared.name) {
                return;
            }

            // Remove temporary event listeners for selector Interactables
            if (!interactables.get(eventTarget)) {
                events.remove(eventTarget,
                    PointerEvent ? pEventTypes.move : 'mousemove',
                    listeners.pointerHover);
            }

            if (this.target && this.target.options.styleCursor && !this.interacting()) {
                this.target._doc.documentElement.style.cursor = '';
            }
        },

        selectorDown: function (pointer, event, eventTarget, curEventTarget) {
            var that = this,
            // copy event to be used in timeout for IE8
                eventCopy = events.useAttachEvent ? extend({}, event) : event,
                element = eventTarget,
                pointerIndex = this.addPointer(pointer),
                action;

            this.holdTimers[pointerIndex] = setTimeout(function () {
                that.pointerHold(events.useAttachEvent ? eventCopy : pointer, eventCopy, eventTarget, curEventTarget);
            }, defaultOptions._holdDuration);

            this.pointerIsDown = true;

            // Check if the down event hits the current inertia target
            if (this.inertiaStatus.active && this.target.selector) {
                // climb up the DOM tree from the event target
                while (isElement(element)) {

                    // if this element is the current inertia target element
                    if (element === this.element
                            // and the prospective action is the same as the ongoing one
                        && validateAction(this.target.getAction(pointer, event, this, this.element), this.target).name === this.prepared.name) {

                        // stop inertia so that the next move will be a normal one
                        cancelFrame(this.inertiaStatus.i);
                        this.inertiaStatus.active = false;

                        this.collectEventTargets(pointer, event, eventTarget, 'down');
                        return;
                    }
                    element = parentElement(element);
                }
            }

            // do nothing if interacting
            if (this.interacting()) {
                this.collectEventTargets(pointer, event, eventTarget, 'down');
                return;
            }

            function pushMatches(interactable, selector, context) {
                var elements = ie8MatchesSelector
                    ? context.querySelectorAll(selector)
                    : undefined;

                if (inContext(interactable, element)
                    && !testIgnore(interactable, element, eventTarget)
                    && testAllow(interactable, element, eventTarget)
                    && matchesSelector(element, selector, elements)) {

                    that.matches.push(interactable);
                    that.matchElements.push(element);
                }
            }

            // update pointer coords for defaultActionChecker to use
            this.setEventXY(this.curCoords, [pointer]);
            this.downEvent = event;

            while (isElement(element) && !action) {
                this.matches = [];
                this.matchElements = [];

                interactables.forEachSelector(pushMatches);

                action = this.validateSelector(pointer, event, this.matches, this.matchElements);
                element = parentElement(element);
            }

            if (action) {
                this.prepared.name = action.name;
                this.prepared.axis = action.axis;
                this.prepared.edges = action.edges;

                this.collectEventTargets(pointer, event, eventTarget, 'down');

                return this.pointerDown(pointer, event, eventTarget, curEventTarget, action);
            }
            else {
                // do these now since pointerDown isn't being called from here
                this.downTimes[pointerIndex] = new Date().getTime();
                this.downTargets[pointerIndex] = eventTarget;
                pointerExtend(this.downPointer, pointer);

                copyCoords(this.prevCoords, this.curCoords);
                this.pointerWasMoved = false;
            }

            this.collectEventTargets(pointer, event, eventTarget, 'down');
        },

        // Determine action to be performed on next pointerMove and add appropriate
        // style and event Listeners
        pointerDown: function (pointer, event, eventTarget, curEventTarget, forceAction) {
            if (!forceAction && !this.inertiaStatus.active && this.pointerWasMoved && this.prepared.name) {
                this.checkAndPreventDefault(event, this.target, this.element);

                return;
            }

            this.pointerIsDown = true;
            this.downEvent = event;

            var pointerIndex = this.addPointer(pointer),
                action;

            // If it is the second touch of a multi-touch gesture, keep the
            // target the same and get a new action if a target was set by the
            // first touch
            if (this.pointerIds.length > 1 && this.target._element === this.element) {
                var newAction = validateAction(forceAction || this.target.getAction(pointer, event, this, this.element), this.target);

                if (withinInteractionLimit(this.target, this.element, newAction)) {
                    action = newAction;
                }

                this.prepared.name = null;
            }
            // Otherwise, set the target if there is no action prepared
            else if (!this.prepared.name) {
                var interactable = interactables.get(curEventTarget);

                if (interactable
                    && !testIgnore(interactable, curEventTarget, eventTarget)
                    && testAllow(interactable, curEventTarget, eventTarget)
                    && (action = validateAction(forceAction || interactable.getAction(pointer, event, this, curEventTarget), interactable, eventTarget))
                    && withinInteractionLimit(interactable, curEventTarget, action)) {
                    this.target = interactable;
                    this.element = curEventTarget;
                }
            }

            var target = this.target,
                options = target && target.options;

            if (target && (forceAction || !this.prepared.name)) {
                action = action || validateAction(forceAction || target.getAction(pointer, event, this, curEventTarget), target, this.element);

                this.setEventXY(this.startCoords, this.pointers);

                if (!action) {
                    return;
                }

                if (options.styleCursor) {
                    target._doc.documentElement.style.cursor = getActionCursor(action);
                }

                this.resizeAxes = action.name === 'resize' ? action.axis : null;

                if (action === 'gesture' && this.pointerIds.length < 2) {
                    action = null;
                }

                this.prepared.name = action.name;
                this.prepared.axis = action.axis;
                this.prepared.edges = action.edges;

                this.snapStatus.snappedX = this.snapStatus.snappedY =
                    this.restrictStatus.restrictedX = this.restrictStatus.restrictedY = NaN;

                this.downTimes[pointerIndex] = new Date().getTime();
                this.downTargets[pointerIndex] = eventTarget;
                pointerExtend(this.downPointer, pointer);

                copyCoords(this.prevCoords, this.startCoords);
                this.pointerWasMoved = false;

                this.checkAndPreventDefault(event, target, this.element);
            }
            // if inertia is active try to resume action
            else if (this.inertiaStatus.active
                && curEventTarget === this.element
                && validateAction(target.getAction(pointer, event, this, this.element), target).name === this.prepared.name) {

                cancelFrame(this.inertiaStatus.i);
                this.inertiaStatus.active = false;

                this.checkAndPreventDefault(event, target, this.element);
            }
        },

        setModifications: function (coords, preEnd) {
            var target = this.target,
                shouldMove = true,
                shouldSnap = checkSnap(target, this.prepared.name) && (!target.options[this.prepared.name].snap.endOnly || preEnd),
                shouldRestrict = checkRestrict(target, this.prepared.name) && (!target.options[this.prepared.name].restrict.endOnly || preEnd);

            if (shouldSnap) {
                this.setSnapping   (coords);
            } else {
                this.snapStatus.locked = false;
            }
            if (shouldRestrict) {
                this.setRestriction(coords);
            } else {
                this.restrictStatus.restricted = false;
            }

            if (shouldSnap && this.snapStatus.locked && !this.snapStatus.changed) {
                shouldMove = shouldRestrict && this.restrictStatus.restricted && this.restrictStatus.changed;
            }
            else if (shouldRestrict && this.restrictStatus.restricted && !this.restrictStatus.changed) {
                shouldMove = false;
            }

            return shouldMove;
        },

        setStartOffsets: function (action, interactable, element) {
            var rect = interactable.getRect(element),
                origin = getOriginXY(interactable, element),
                snap = interactable.options[this.prepared.name].snap,
                restrict = interactable.options[this.prepared.name].restrict,
                width, height;

            if (rect) {
                this.startOffset.left = this.startCoords.page.x - rect.left;
                this.startOffset.top = this.startCoords.page.y - rect.top;

                this.startOffset.right = rect.right - this.startCoords.page.x;
                this.startOffset.bottom = rect.bottom - this.startCoords.page.y;

                if ('width' in rect) {
                    width = rect.width;
                }
                else {
                    width = rect.right - rect.left;
                }
                if ('height' in rect) {
                    height = rect.height;
                }
                else {
                    height = rect.bottom - rect.top;
                }
            }
            else {
                this.startOffset.left = this.startOffset.top = this.startOffset.right = this.startOffset.bottom = 0;
            }

            this.snapOffsets.splice(0);

            var snapOffset = snap && snap.offset === 'startCoords'
                ? {
                x: this.startCoords.page.x - origin.x,
                y: this.startCoords.page.y - origin.y
            }
                : snap && snap.offset || {x: 0, y: 0};

            if (rect && snap && snap.relativePoints && snap.relativePoints.length) {
                for (var i = 0; i < snap.relativePoints.length; i++) {
                    this.snapOffsets.push({
                        x: this.startOffset.left - (width * snap.relativePoints[i].x) + snapOffset.x,
                        y: this.startOffset.top - (height * snap.relativePoints[i].y) + snapOffset.y
                    });
                }
            }
            else {
                this.snapOffsets.push(snapOffset);
            }

            if (rect && restrict.elementRect) {
                this.restrictOffset.left = this.startOffset.left - (width * restrict.elementRect.left);
                this.restrictOffset.top = this.startOffset.top - (height * restrict.elementRect.top);

                this.restrictOffset.right = this.startOffset.right - (width * (1 - restrict.elementRect.right));
                this.restrictOffset.bottom = this.startOffset.bottom - (height * (1 - restrict.elementRect.bottom));
            }
            else {
                this.restrictOffset.left = this.restrictOffset.top = this.restrictOffset.right = this.restrictOffset.bottom = 0;
            }
        },

        /*\
         * Interaction.start
         [ method ]
         *
         * Start an action with the given Interactable and Element as tartgets. The
         * action must be enabled for the target Interactable and an appropriate number
         * of pointers must be held down â€“ 1 for drag/resize, 2 for gesture.
         *
         * Use it with `interactable.<action>able({ manualStart: false })` to always
         * [start actions manually](https://github.com/taye/interact.js/issues/114)
         *
         - action       (object)  The action to be performed - drag, resize, etc.
         - interactable (Interactable) The Interactable to target
         - element      (Element) The DOM Element to target
         = (object) interact
         **
         | interact(target)
         |   .draggable({
         |     // disable the default drag start by down->move
         |     manualStart: true
         |   })
         |   // start dragging after the user holds the pointer down
         |   .on('hold', function (event) {
         |     var interaction = event.interaction;
         |
         |     if (!interaction.interacting()) {
         |       interaction.start({ name: 'drag' },
         |                         event.interactable,
         |                         event.currentTarget);
         |     }
         | });
         \*/
        start: function (action, interactable, element) {
            if (this.interacting()
                || !this.pointerIsDown
                || this.pointerIds.length < (action.name === 'gesture' ? 2 : 1)) {
                return;
            }

            // if this interaction had been removed after stopping
            // add it back
            if (indexOf(interactions, this) === -1) {
                interactions.push(this);
            }

            // set the startCoords if there was no prepared action
            if (!this.prepared.name) {
                this.setEventXY(this.startCoords);
            }

            this.prepared.name = action.name;
            this.prepared.axis = action.axis;
            this.prepared.edges = action.edges;
            this.target = interactable;
            this.element = element;

            this.setStartOffsets(action.name, interactable, element);
            this.setModifications(this.startCoords.page);

            this.prevEvent = this[this.prepared.name + 'Start'](this.downEvent);
        },

        pointerMove: function (pointer, event, eventTarget, curEventTarget, preEnd) {
            if (this.inertiaStatus.active) {
                var pageUp = this.inertiaStatus.upCoords.page;
                var clientUp = this.inertiaStatus.upCoords.client;

                var inertiaPosition = {
                    pageX: pageUp.x + this.inertiaStatus.sx,
                    pageY: pageUp.y + this.inertiaStatus.sy,
                    clientX: clientUp.x + this.inertiaStatus.sx,
                    clientY: clientUp.y + this.inertiaStatus.sy
                };

                this.setEventXY(this.curCoords, [inertiaPosition]);
            }
            else {
                this.recordPointer(pointer);
                this.setEventXY(this.curCoords, this.pointers);
            }

            var duplicateMove = (this.curCoords.page.x === this.prevCoords.page.x
            && this.curCoords.page.y === this.prevCoords.page.y
            && this.curCoords.client.x === this.prevCoords.client.x
            && this.curCoords.client.y === this.prevCoords.client.y);

            var dx, dy,
                pointerIndex = this.mouse ? 0 : indexOf(this.pointerIds, getPointerId(pointer));

            // register movement greater than pointerMoveTolerance
            if (this.pointerIsDown && !this.pointerWasMoved) {
                dx = this.curCoords.client.x - this.startCoords.client.x;
                dy = this.curCoords.client.y - this.startCoords.client.y;

                this.pointerWasMoved = hypot(dx, dy) > pointerMoveTolerance;
            }

            if (!duplicateMove && (!this.pointerIsDown || this.pointerWasMoved)) {
                if (this.pointerIsDown) {
                    clearTimeout(this.holdTimers[pointerIndex]);
                }

                this.collectEventTargets(pointer, event, eventTarget, 'move');
            }

            if (!this.pointerIsDown) {
                return;
            }

            if (duplicateMove && this.pointerWasMoved && !preEnd) {
                this.checkAndPreventDefault(event, this.target, this.element);
                return;
            }

            // set pointer coordinate, time changes and speeds
            setEventDeltas(this.pointerDelta, this.prevCoords, this.curCoords);

            if (!this.prepared.name) {
                return;
            }

            if (this.pointerWasMoved
                    // ignore movement while inertia is active
                && (!this.inertiaStatus.active || (pointer instanceof InteractEvent && /inertiastart/.test(pointer.type)))) {

                // if just starting an action, calculate the pointer speed now
                if (!this.interacting()) {
                    setEventDeltas(this.pointerDelta, this.prevCoords, this.curCoords);

                    // check if a drag is in the correct axis
                    if (this.prepared.name === 'drag') {
                        var absX = Math.abs(dx),
                            absY = Math.abs(dy),
                            targetAxis = this.target.options.drag.axis,
                            axis = (absX > absY ? 'x' : absX < absY ? 'y' : 'xy');

                        // if the movement isn't in the axis of the interactable
                        if (axis !== 'xy' && targetAxis !== 'xy' && targetAxis !== axis) {
                            // cancel the prepared action
                            this.prepared.name = null;

                            // then try to get a drag from another ineractable

                            var element = eventTarget;

                            // check element interactables
                            while (isElement(element)) {
                                var elementInteractable = interactables.get(element);

                                if (elementInteractable
                                    && elementInteractable !== this.target
                                    && !elementInteractable.options.drag.manualStart
                                    && elementInteractable.getAction(this.downPointer, this.downEvent, this, element).name === 'drag'
                                    && checkAxis(axis, elementInteractable)) {

                                    this.prepared.name = 'drag';
                                    this.target = elementInteractable;
                                    this.element = element;
                                    break;
                                }

                                element = parentElement(element);
                            }

                            // if there's no drag from element interactables,
                            // check the selector interactables
                            if (!this.prepared.name) {
                                var thisInteraction = this;

                                var getDraggable = function (interactable, selector, context) {
                                    var elements = ie8MatchesSelector
                                        ? context.querySelectorAll(selector)
                                        : undefined;

                                    if (interactable === thisInteraction.target) {
                                        return;
                                    }

                                    if (inContext(interactable, eventTarget)
                                        && !interactable.options.drag.manualStart
                                        && !testIgnore(interactable, element, eventTarget)
                                        && testAllow(interactable, element, eventTarget)
                                        && matchesSelector(element, selector, elements)
                                        && interactable.getAction(thisInteraction.downPointer, thisInteraction.downEvent, thisInteraction, element).name === 'drag'
                                        && checkAxis(axis, interactable)
                                        && withinInteractionLimit(interactable, element, 'drag')) {

                                        return interactable;
                                    }
                                };

                                element = eventTarget;

                                while (isElement(element)) {
                                    var selectorInteractable = interactables.forEachSelector(getDraggable);

                                    if (selectorInteractable) {
                                        this.prepared.name = 'drag';
                                        this.target = selectorInteractable;
                                        this.element = element;
                                        break;
                                    }

                                    element = parentElement(element);
                                }
                            }
                        }
                    }
                }

                var starting = !!this.prepared.name && !this.interacting();

                if (starting
                    && (this.target.options[this.prepared.name].manualStart
                    || !withinInteractionLimit(this.target, this.element, this.prepared))) {
                    this.stop(event);
                    return;
                }

                if (this.prepared.name && this.target) {
                    if (starting) {
                        this.start(this.prepared, this.target, this.element);
                    }

                    var shouldMove = this.setModifications(this.curCoords.page, preEnd);

                    // move if snapping or restriction doesn't prevent it
                    if (shouldMove || starting) {
                        this.prevEvent = this[this.prepared.name + 'Move'](event);
                    }

                    this.checkAndPreventDefault(event, this.target, this.element);
                }
            }

            copyCoords(this.prevCoords, this.curCoords);

            if (this.dragging || this.resizing) {
                this.autoScrollMove(pointer);
            }
        },

        dragStart: function (event) {
            var dragEvent = new InteractEvent(this, event, 'drag', 'start', this.element);

            this.dragging = true;
            this.target.fire(dragEvent);

            // reset active dropzones
            this.activeDrops.dropzones = [];
            this.activeDrops.elements = [];
            this.activeDrops.rects = [];

            if (!this.dynamicDrop) {
                this.setActiveDrops(this.element);
            }

            var dropEvents = this.getDropEvents(event, dragEvent);

            if (dropEvents.activate) {
                this.fireActiveDrops(dropEvents.activate);
            }

            return dragEvent;
        },

        dragMove: function (event) {
            var target = this.target,
                dragEvent = new InteractEvent(this, event, 'drag', 'move', this.element),
                draggableElement = this.element,
                drop = this.getDrop(dragEvent, event, draggableElement);

            this.dropTarget = drop.dropzone;
            this.dropElement = drop.element;

            var dropEvents = this.getDropEvents(event, dragEvent);

            target.fire(dragEvent);

            if (dropEvents.leave) {
                this.prevDropTarget.fire(dropEvents.leave);
            }
            if (dropEvents.enter) {
                this.dropTarget.fire(dropEvents.enter);
            }
            if (dropEvents.move) {
                this.dropTarget.fire(dropEvents.move);
            }

            this.prevDropTarget = this.dropTarget;
            this.prevDropElement = this.dropElement;

            return dragEvent;
        },

        resizeStart: function (event) {
            var resizeEvent = new InteractEvent(this, event, 'resize', 'start', this.element);

            if (this.prepared.edges) {
                var startRect = this.target.getRect(this.element);

                /*
                 * When using the `resizable.square` or `resizable.preserveAspectRatio` options, resizing from one edge
                 * will affect another. E.g. with `resizable.square`, resizing to make the right edge larger will make
                 * the bottom edge larger by the same amount. We call these 'linked' edges. Any linked edges will depend
                 * on the active edges and the edge being interacted with.
                 */
                if (this.target.options.resize.square || this.target.options.resize.preserveAspectRatio) {
                    var linkedEdges = extend({}, this.prepared.edges);

                    linkedEdges.top = linkedEdges.top || (linkedEdges.left && !linkedEdges.bottom);
                    linkedEdges.left = linkedEdges.left || (linkedEdges.top && !linkedEdges.right );
                    linkedEdges.bottom = linkedEdges.bottom || (linkedEdges.right && !linkedEdges.top   );
                    linkedEdges.right = linkedEdges.right || (linkedEdges.bottom && !linkedEdges.left  );

                    this.prepared._linkedEdges = linkedEdges;
                }
                else {
                    this.prepared._linkedEdges = null;
                }

                // if using `resizable.preserveAspectRatio` option, record aspect ratio at the start of the resize
                if (this.target.options.resize.preserveAspectRatio) {
                    this.resizeStartAspectRatio = startRect.width / startRect.height;
                }

                this.resizeRects = {
                    start: startRect,
                    current: extend({}, startRect),
                    restricted: extend({}, startRect),
                    previous: extend({}, startRect),
                    delta: {
                        left: 0, right: 0, width: 0,
                        top: 0, bottom: 0, height: 0
                    }
                };

                resizeEvent.rect = this.resizeRects.restricted;
                resizeEvent.deltaRect = this.resizeRects.delta;
            }

            this.target.fire(resizeEvent);

            this.resizing = true;

            return resizeEvent;
        },

        resizeMove: function (event) {
            var resizeEvent = new InteractEvent(this, event, 'resize', 'move', this.element);

            var edges = this.prepared.edges,
                invert = this.target.options.resize.invert,
                invertible = invert === 'reposition' || invert === 'negate';

            if (edges) {
                var dx = resizeEvent.dx,
                    dy = resizeEvent.dy,

                    start = this.resizeRects.start,
                    current = this.resizeRects.current,
                    restricted = this.resizeRects.restricted,
                    delta = this.resizeRects.delta,
                    previous = extend(this.resizeRects.previous, restricted),

                    originalEdges = edges;

                // `resize.preserveAspectRatio` takes precedence over `resize.square`
                if (this.target.options.resize.preserveAspectRatio) {
                    var resizeStartAspectRatio = this.resizeStartAspectRatio;

                    edges = this.prepared._linkedEdges;

                    if ((originalEdges.left && originalEdges.bottom)
                        || (originalEdges.right && originalEdges.top)) {
                        dy = -dx / resizeStartAspectRatio;
                    }
                    else if (originalEdges.left || originalEdges.right) {
                        dy = dx / resizeStartAspectRatio;
                    }
                    else if (originalEdges.top || originalEdges.bottom) {
                        dx = dy * resizeStartAspectRatio;
                    }
                }
                else if (this.target.options.resize.square) {
                    edges = this.prepared._linkedEdges;

                    if ((originalEdges.left && originalEdges.bottom)
                        || (originalEdges.right && originalEdges.top)) {
                        dy = -dx;
                    }
                    else if (originalEdges.left || originalEdges.right) {
                        dy = dx;
                    }
                    else if (originalEdges.top || originalEdges.bottom) {
                        dx = dy;
                    }
                }

                // update the 'current' rect without modifications
                if (edges.top) {
                    current.top += dy;
                }
                if (edges.bottom) {
                    current.bottom += dy;
                }
                if (edges.left) {
                    current.left += dx;
                }
                if (edges.right) {
                    current.right += dx;
                }

                if (invertible) {
                    // if invertible, copy the current rect
                    extend(restricted, current);

                    if (invert === 'reposition') {
                        // swap edge values if necessary to keep width/height positive
                        var swap;

                        if (restricted.top > restricted.bottom) {
                            swap = restricted.top;

                            restricted.top = restricted.bottom;
                            restricted.bottom = swap;
                        }
                        if (restricted.left > restricted.right) {
                            swap = restricted.left;

                            restricted.left = restricted.right;
                            restricted.right = swap;
                        }
                    }
                }
                else {
                    // if not invertible, restrict to minimum of 0x0 rect
                    restricted.top = Math.min(current.top, start.bottom);
                    restricted.bottom = Math.max(current.bottom, start.top);
                    restricted.left = Math.min(current.left, start.right);
                    restricted.right = Math.max(current.right, start.left);
                }

                restricted.width = restricted.right - restricted.left;
                restricted.height = restricted.bottom - restricted.top;

                for (var edge in restricted) {
                    delta[edge] = restricted[edge] - previous[edge];
                }

                resizeEvent.edges = this.prepared.edges;
                resizeEvent.rect = restricted;
                resizeEvent.deltaRect = delta;
            }

            this.target.fire(resizeEvent);

            return resizeEvent;
        },

        gestureStart: function (event) {
            var gestureEvent = new InteractEvent(this, event, 'gesture', 'start', this.element);

            gestureEvent.ds = 0;

            this.gesture.startDistance = this.gesture.prevDistance = gestureEvent.distance;
            this.gesture.startAngle = this.gesture.prevAngle = gestureEvent.angle;
            this.gesture.scale = 1;

            this.gesturing = true;

            this.target.fire(gestureEvent);

            return gestureEvent;
        },

        gestureMove: function (event) {
            if (!this.pointerIds.length) {
                return this.prevEvent;
            }

            var gestureEvent;

            gestureEvent = new InteractEvent(this, event, 'gesture', 'move', this.element);
            gestureEvent.ds = gestureEvent.scale - this.gesture.scale;

            this.target.fire(gestureEvent);

            this.gesture.prevAngle = gestureEvent.angle;
            this.gesture.prevDistance = gestureEvent.distance;

            if (gestureEvent.scale !== Infinity &&
                gestureEvent.scale !== null &&
                gestureEvent.scale !== undefined && !isNaN(gestureEvent.scale)) {

                this.gesture.scale = gestureEvent.scale;
            }

            return gestureEvent;
        },

        pointerHold: function (pointer, event, eventTarget) {
            this.collectEventTargets(pointer, event, eventTarget, 'hold');
        },

        pointerUp: function (pointer, event, eventTarget, curEventTarget) {
            var pointerIndex = this.mouse ? 0 : indexOf(this.pointerIds, getPointerId(pointer));

            clearTimeout(this.holdTimers[pointerIndex]);

            this.collectEventTargets(pointer, event, eventTarget, 'up');
            this.collectEventTargets(pointer, event, eventTarget, 'tap');

            this.pointerEnd(pointer, event, eventTarget, curEventTarget);

            this.removePointer(pointer);
        },

        pointerCancel: function (pointer, event, eventTarget, curEventTarget) {
            var pointerIndex = this.mouse ? 0 : indexOf(this.pointerIds, getPointerId(pointer));

            clearTimeout(this.holdTimers[pointerIndex]);

            this.collectEventTargets(pointer, event, eventTarget, 'cancel');
            this.pointerEnd(pointer, event, eventTarget, curEventTarget);

            this.removePointer(pointer);
        },

        // http://www.quirksmode.org/dom/events/click.html
        // >Events leading to dblclick
        //
        // IE8 doesn't fire down event before dblclick.
        // This workaround tries to fire a tap and doubletap after dblclick
        ie8Dblclick: function (pointer, event, eventTarget) {
            if (this.prevTap
                && event.clientX === this.prevTap.clientX
                && event.clientY === this.prevTap.clientY
                && eventTarget === this.prevTap.target) {

                this.downTargets[0] = eventTarget;
                this.downTimes[0] = new Date().getTime();
                this.collectEventTargets(pointer, event, eventTarget, 'tap');
            }
        },

        // End interact move events and stop auto-scroll unless inertia is enabled
        pointerEnd: function (pointer, event, eventTarget, curEventTarget) {
            var endEvent,
                target = this.target,
                options = target && target.options,
                inertiaOptions = options && this.prepared.name && options[this.prepared.name].inertia,
                inertiaStatus = this.inertiaStatus;

            if (this.interacting()) {

                if (inertiaStatus.active && !inertiaStatus.ending) {
                    return;
                }

                var pointerSpeed,
                    now = new Date().getTime(),
                    inertiaPossible = false,
                    inertia = false,
                    smoothEnd = false,
                    endSnap = checkSnap(target, this.prepared.name) && options[this.prepared.name].snap.endOnly,
                    endRestrict = checkRestrict(target, this.prepared.name) && options[this.prepared.name].restrict.endOnly,
                    dx = 0,
                    dy = 0,
                    startEvent;

                if (this.dragging) {
                    if (options.drag.axis === 'x') {
                        pointerSpeed = Math.abs(this.pointerDelta.client.vx);
                    }
                    else if (options.drag.axis === 'y') {
                        pointerSpeed = Math.abs(this.pointerDelta.client.vy);
                    }
                    else   /*options.drag.axis === 'xy'*/{
                        pointerSpeed = this.pointerDelta.client.speed;
                    }
                }
                else {
                    pointerSpeed = this.pointerDelta.client.speed;
                }

                // check if inertia should be started
                inertiaPossible = (inertiaOptions && inertiaOptions.enabled
                && this.prepared.name !== 'gesture'
                && event !== inertiaStatus.startEvent);

                inertia = (inertiaPossible
                && (now - this.curCoords.timeStamp) < 50
                && pointerSpeed > inertiaOptions.minSpeed
                && pointerSpeed > inertiaOptions.endSpeed);

                if (inertiaPossible && !inertia && (endSnap || endRestrict)) {

                    var snapRestrict = {};

                    snapRestrict.snap = snapRestrict.restrict = snapRestrict;

                    if (endSnap) {
                        this.setSnapping(this.curCoords.page, snapRestrict);
                        if (snapRestrict.locked) {
                            dx += snapRestrict.dx;
                            dy += snapRestrict.dy;
                        }
                    }

                    if (endRestrict) {
                        this.setRestriction(this.curCoords.page, snapRestrict);
                        if (snapRestrict.restricted) {
                            dx += snapRestrict.dx;
                            dy += snapRestrict.dy;
                        }
                    }

                    if (dx || dy) {
                        smoothEnd = true;
                    }
                }

                if (inertia || smoothEnd) {
                    copyCoords(inertiaStatus.upCoords, this.curCoords);

                    this.pointers[0] = inertiaStatus.startEvent = startEvent =
                        new InteractEvent(this, event, this.prepared.name, 'inertiastart', this.element);

                    inertiaStatus.t0 = now;

                    target.fire(inertiaStatus.startEvent);

                    if (inertia) {
                        inertiaStatus.vx0 = this.pointerDelta.client.vx;
                        inertiaStatus.vy0 = this.pointerDelta.client.vy;
                        inertiaStatus.v0 = pointerSpeed;

                        this.calcInertia(inertiaStatus);

                        var page = extend({}, this.curCoords.page),
                            origin = getOriginXY(target, this.element),
                            statusObject;

                        page.x = page.x + inertiaStatus.xe - origin.x;
                        page.y = page.y + inertiaStatus.ye - origin.y;

                        statusObject = {
                            useStatusXY: true,
                            x: page.x,
                            y: page.y,
                            dx: 0,
                            dy: 0,
                            snap: null
                        };

                        statusObject.snap = statusObject;

                        dx = dy = 0;

                        if (endSnap) {
                            var snap = this.setSnapping(this.curCoords.page, statusObject);

                            if (snap.locked) {
                                dx += snap.dx;
                                dy += snap.dy;
                            }
                        }

                        if (endRestrict) {
                            var restrict = this.setRestriction(this.curCoords.page, statusObject);

                            if (restrict.restricted) {
                                dx += restrict.dx;
                                dy += restrict.dy;
                            }
                        }

                        inertiaStatus.modifiedXe += dx;
                        inertiaStatus.modifiedYe += dy;

                        inertiaStatus.i = reqFrame(this.boundInertiaFrame);
                    }
                    else {
                        inertiaStatus.smoothEnd = true;
                        inertiaStatus.xe = dx;
                        inertiaStatus.ye = dy;

                        inertiaStatus.sx = inertiaStatus.sy = 0;

                        inertiaStatus.i = reqFrame(this.boundSmoothEndFrame);
                    }

                    inertiaStatus.active = true;
                    return;
                }

                if (endSnap || endRestrict) {
                    // fire a move event at the snapped coordinates
                    this.pointerMove(pointer, event, eventTarget, curEventTarget, true);
                }
            }

            if (this.dragging) {
                endEvent = new InteractEvent(this, event, 'drag', 'end', this.element);

                var draggableElement = this.element,
                    drop = this.getDrop(endEvent, event, draggableElement);

                this.dropTarget = drop.dropzone;
                this.dropElement = drop.element;

                var dropEvents = this.getDropEvents(event, endEvent);

                if (dropEvents.leave) {
                    this.prevDropTarget.fire(dropEvents.leave);
                }
                if (dropEvents.enter) {
                    this.dropTarget.fire(dropEvents.enter);
                }
                if (dropEvents.drop) {
                    this.dropTarget.fire(dropEvents.drop);
                }
                if (dropEvents.deactivate) {
                    this.fireActiveDrops(dropEvents.deactivate);
                }

                target.fire(endEvent);
            }
            else if (this.resizing) {
                endEvent = new InteractEvent(this, event, 'resize', 'end', this.element);
                target.fire(endEvent);
            }
            else if (this.gesturing) {
                endEvent = new InteractEvent(this, event, 'gesture', 'end', this.element);
                target.fire(endEvent);
            }

            this.stop(event);
        },

        collectDrops: function (element) {
            var drops = [],
                elements = [],
                i;

            element = element || this.element;

            // collect all dropzones and their elements which qualify for a drop
            for (i = 0; i < interactables.length; i++) {
                if (!interactables[i].options.drop.enabled) {
                    continue;
                }

                var current = interactables[i],
                    accept = current.options.drop.accept;

                // test the draggable element against the dropzone's accept setting
                if ((isElement(accept) && accept !== element)
                    || (isString(accept)
                    && !matchesSelector(element, accept))) {

                    continue;
                }

                // query for new elements if necessary
                var dropElements = current.selector ? current._context.querySelectorAll(current.selector) : [current._element];

                for (var j = 0, len = dropElements.length; j < len; j++) {
                    var currentElement = dropElements[j];

                    if (currentElement === element) {
                        continue;
                    }

                    drops.push(current);
                    elements.push(currentElement);
                }
            }

            return {
                dropzones: drops,
                elements: elements
            };
        },

        fireActiveDrops: function (event) {
            var i,
                current,
                currentElement,
                prevElement;

            // loop through all active dropzones and trigger event
            for (i = 0; i < this.activeDrops.dropzones.length; i++) {
                current = this.activeDrops.dropzones[i];
                currentElement = this.activeDrops.elements [i];

                // prevent trigger of duplicate events on same element
                if (currentElement !== prevElement) {
                    // set current element as event target
                    event.target = currentElement;
                    current.fire(event);
                }
                prevElement = currentElement;
            }
        },

        // Collect a new set of possible drops and save them in activeDrops.
        // setActiveDrops should always be called when a drag has just started or a
        // drag event happens while dynamicDrop is true
        setActiveDrops: function (dragElement) {
            // get dropzones and their elements that could receive the draggable
            var possibleDrops = this.collectDrops(dragElement, true);

            this.activeDrops.dropzones = possibleDrops.dropzones;
            this.activeDrops.elements = possibleDrops.elements;
            this.activeDrops.rects = [];

            for (var i = 0; i < this.activeDrops.dropzones.length; i++) {
                this.activeDrops.rects[i] = this.activeDrops.dropzones[i].getRect(this.activeDrops.elements[i]);
            }
        },

        getDrop: function (dragEvent, event, dragElement) {
            var validDrops = [];

            if (dynamicDrop) {
                this.setActiveDrops(dragElement);
            }

            // collect all dropzones and their elements which qualify for a drop
            for (var j = 0; j < this.activeDrops.dropzones.length; j++) {
                var current = this.activeDrops.dropzones[j],
                    currentElement = this.activeDrops.elements [j],
                    rect = this.activeDrops.rects    [j];

                validDrops.push(current.dropCheck(dragEvent, event, this.target, dragElement, currentElement, rect)
                    ? currentElement
                    : null);
            }

            // get the most appropriate dropzone based on DOM depth and order
            var dropIndex = indexOfDeepestElement(validDrops),
                dropzone = this.activeDrops.dropzones[dropIndex] || null,
                element = this.activeDrops.elements [dropIndex] || null;

            return {
                dropzone: dropzone,
                element: element
            };
        },

        getDropEvents: function (pointerEvent, dragEvent) {
            var dropEvents = {
                enter: null,
                leave: null,
                activate: null,
                deactivate: null,
                move: null,
                drop: null
            };

            if (this.dropElement !== this.prevDropElement) {
                // if there was a prevDropTarget, create a dragleave event
                if (this.prevDropTarget) {
                    dropEvents.leave = {
                        target: this.prevDropElement,
                        dropzone: this.prevDropTarget,
                        relatedTarget: dragEvent.target,
                        draggable: dragEvent.interactable,
                        dragEvent: dragEvent,
                        interaction: this,
                        timeStamp: dragEvent.timeStamp,
                        type: 'dragleave'
                    };

                    dragEvent.dragLeave = this.prevDropElement;
                    dragEvent.prevDropzone = this.prevDropTarget;
                }
                // if the dropTarget is not null, create a dragenter event
                if (this.dropTarget) {
                    dropEvents.enter = {
                        target: this.dropElement,
                        dropzone: this.dropTarget,
                        relatedTarget: dragEvent.target,
                        draggable: dragEvent.interactable,
                        dragEvent: dragEvent,
                        interaction: this,
                        timeStamp: dragEvent.timeStamp,
                        type: 'dragenter'
                    };

                    dragEvent.dragEnter = this.dropElement;
                    dragEvent.dropzone = this.dropTarget;
                }
            }

            if (dragEvent.type === 'dragend' && this.dropTarget) {
                dropEvents.drop = {
                    target: this.dropElement,
                    dropzone: this.dropTarget,
                    relatedTarget: dragEvent.target,
                    draggable: dragEvent.interactable,
                    dragEvent: dragEvent,
                    interaction: this,
                    timeStamp: dragEvent.timeStamp,
                    type: 'drop'
                };

                dragEvent.dropzone = this.dropTarget;
            }
            if (dragEvent.type === 'dragstart') {
                dropEvents.activate = {
                    target: null,
                    dropzone: null,
                    relatedTarget: dragEvent.target,
                    draggable: dragEvent.interactable,
                    dragEvent: dragEvent,
                    interaction: this,
                    timeStamp: dragEvent.timeStamp,
                    type: 'dropactivate'
                };
            }
            if (dragEvent.type === 'dragend') {
                dropEvents.deactivate = {
                    target: null,
                    dropzone: null,
                    relatedTarget: dragEvent.target,
                    draggable: dragEvent.interactable,
                    dragEvent: dragEvent,
                    interaction: this,
                    timeStamp: dragEvent.timeStamp,
                    type: 'dropdeactivate'
                };
            }
            if (dragEvent.type === 'dragmove' && this.dropTarget) {
                dropEvents.move = {
                    target: this.dropElement,
                    dropzone: this.dropTarget,
                    relatedTarget: dragEvent.target,
                    draggable: dragEvent.interactable,
                    dragEvent: dragEvent,
                    interaction: this,
                    dragmove: dragEvent,
                    timeStamp: dragEvent.timeStamp,
                    type: 'dropmove'
                };
                dragEvent.dropzone = this.dropTarget;
            }

            return dropEvents;
        },

        currentAction: function () {
            return (this.dragging && 'drag') || (this.resizing && 'resize') || (this.gesturing && 'gesture') || null;
        },

        interacting: function () {
            return this.dragging || this.resizing || this.gesturing;
        },

        clearTargets: function () {
            this.target = this.element = null;

            this.dropTarget = this.dropElement = this.prevDropTarget = this.prevDropElement = null;
        },

        stop: function (event) {
            if (this.interacting()) {
                autoScroll.stop();
                this.matches = [];
                this.matchElements = [];

                var target = this.target;

                if (target.options.styleCursor) {
                    target._doc.documentElement.style.cursor = '';
                }

                // prevent Default only if were previously interacting
                if (event && isFunction(event.preventDefault)) {
                    this.checkAndPreventDefault(event, target, this.element);
                }

                if (this.dragging) {
                    this.activeDrops.dropzones = this.activeDrops.elements = this.activeDrops.rects = null;
                }
            }

            this.clearTargets();

            this.pointerIsDown = this.snapStatus.locked = this.dragging = this.resizing = this.gesturing = false;
            this.prepared.name = this.prevEvent = null;
            this.inertiaStatus.resumeDx = this.inertiaStatus.resumeDy = 0;

            // remove pointers if their ID isn't in this.pointerIds
            for (var i = 0; i < this.pointers.length; i++) {
                if (indexOf(this.pointerIds, getPointerId(this.pointers[i])) === -1) {
                    this.pointers.splice(i, 1);
                }
            }
        },

        inertiaFrame: function () {
            var inertiaStatus = this.inertiaStatus,
                options = this.target.options[this.prepared.name].inertia,
                lambda = options.resistance,
                t = new Date().getTime() / 1000 - inertiaStatus.t0;

            if (t < inertiaStatus.te) {

                var progress = 1 - (Math.exp(-lambda * t) - inertiaStatus.lambda_v0) / inertiaStatus.one_ve_v0;

                if (inertiaStatus.modifiedXe === inertiaStatus.xe && inertiaStatus.modifiedYe === inertiaStatus.ye) {
                    inertiaStatus.sx = inertiaStatus.xe * progress;
                    inertiaStatus.sy = inertiaStatus.ye * progress;
                }
                else {
                    var quadPoint = getQuadraticCurvePoint(
                        0, 0,
                        inertiaStatus.xe, inertiaStatus.ye,
                        inertiaStatus.modifiedXe, inertiaStatus.modifiedYe,
                        progress);

                    inertiaStatus.sx = quadPoint.x;
                    inertiaStatus.sy = quadPoint.y;
                }

                this.pointerMove(inertiaStatus.startEvent, inertiaStatus.startEvent);

                inertiaStatus.i = reqFrame(this.boundInertiaFrame);
            }
            else {
                inertiaStatus.ending = true;

                inertiaStatus.sx = inertiaStatus.modifiedXe;
                inertiaStatus.sy = inertiaStatus.modifiedYe;

                this.pointerMove(inertiaStatus.startEvent, inertiaStatus.startEvent);
                this.pointerEnd(inertiaStatus.startEvent, inertiaStatus.startEvent);

                inertiaStatus.active = inertiaStatus.ending = false;
            }
        },

        smoothEndFrame: function () {
            var inertiaStatus = this.inertiaStatus,
                t = new Date().getTime() - inertiaStatus.t0,
                duration = this.target.options[this.prepared.name].inertia.smoothEndDuration;

            if (t < duration) {
                inertiaStatus.sx = easeOutQuad(t, 0, inertiaStatus.xe, duration);
                inertiaStatus.sy = easeOutQuad(t, 0, inertiaStatus.ye, duration);

                this.pointerMove(inertiaStatus.startEvent, inertiaStatus.startEvent);

                inertiaStatus.i = reqFrame(this.boundSmoothEndFrame);
            }
            else {
                inertiaStatus.ending = true;

                inertiaStatus.sx = inertiaStatus.xe;
                inertiaStatus.sy = inertiaStatus.ye;

                this.pointerMove(inertiaStatus.startEvent, inertiaStatus.startEvent);
                this.pointerEnd(inertiaStatus.startEvent, inertiaStatus.startEvent);

                inertiaStatus.smoothEnd =
                    inertiaStatus.active = inertiaStatus.ending = false;
            }
        },

        addPointer: function (pointer) {
            var id = getPointerId(pointer),
                index = this.mouse ? 0 : indexOf(this.pointerIds, id);

            if (index === -1) {
                index = this.pointerIds.length;
            }

            this.pointerIds[index] = id;
            this.pointers[index] = pointer;

            return index;
        },

        removePointer: function (pointer) {
            var id = getPointerId(pointer),
                index = this.mouse ? 0 : indexOf(this.pointerIds, id);

            if (index === -1) {
                return;
            }

            this.pointers.splice(index, 1);
            this.pointerIds.splice(index, 1);
            this.downTargets.splice(index, 1);
            this.downTimes.splice(index, 1);
            this.holdTimers.splice(index, 1);
        },

        recordPointer: function (pointer) {
            var index = this.mouse ? 0 : indexOf(this.pointerIds, getPointerId(pointer));

            if (index === -1) {
                return;
            }

            this.pointers[index] = pointer;
        },

        collectEventTargets: function (pointer, event, eventTarget, eventType) {
            var pointerIndex = this.mouse ? 0 : indexOf(this.pointerIds, getPointerId(pointer));

            // do not fire a tap event if the pointer was moved before being lifted
            if (eventType === 'tap' && (this.pointerWasMoved
                    // or if the pointerup target is different to the pointerdown target
                || !(this.downTargets[pointerIndex] && this.downTargets[pointerIndex] === eventTarget))) {
                return;
            }

            var targets = [],
                elements = [],
                element = eventTarget;

            function collectSelectors(interactable, selector, context) {
                var els = ie8MatchesSelector
                    ? context.querySelectorAll(selector)
                    : undefined;

                if (interactable._iEvents[eventType]
                    && isElement(element)
                    && inContext(interactable, element)
                    && !testIgnore(interactable, element, eventTarget)
                    && testAllow(interactable, element, eventTarget)
                    && matchesSelector(element, selector, els)) {

                    targets.push(interactable);
                    elements.push(element);
                }
            }

            while (element) {
                if (interact.isSet(element) && interact(element)._iEvents[eventType]) {
                    targets.push(interact(element));
                    elements.push(element);
                }

                interactables.forEachSelector(collectSelectors);

                element = parentElement(element);
            }

            // create the tap event even if there are no listeners so that
            // doubletap can still be created and fired
            if (targets.length || eventType === 'tap') {
                this.firePointers(pointer, event, eventTarget, targets, elements, eventType);
            }
        },

        firePointers: function (pointer, event, eventTarget, targets, elements, eventType) {
            var pointerIndex = this.mouse ? 0 : indexOf(this.pointerIds, getPointerId(pointer)),
                pointerEvent = {},
                i,
            // for tap events
                interval, createNewDoubleTap;

            // if it's a doubletap then the event properties would have been
            // copied from the tap event and provided as the pointer argument
            if (eventType === 'doubletap') {
                pointerEvent = pointer;
            }
            else {
                pointerExtend(pointerEvent, event);
                if (event !== pointer) {
                    pointerExtend(pointerEvent, pointer);
                }

                pointerEvent.preventDefault = preventOriginalDefault;
                pointerEvent.stopPropagation = InteractEvent.prototype.stopPropagation;
                pointerEvent.stopImmediatePropagation = InteractEvent.prototype.stopImmediatePropagation;
                pointerEvent.interaction = this;

                pointerEvent.timeStamp = new Date().getTime();
                pointerEvent.originalEvent = event;
                pointerEvent.originalPointer = pointer;
                pointerEvent.type = eventType;
                pointerEvent.pointerId = getPointerId(pointer);
                pointerEvent.pointerType = this.mouse ? 'mouse' : !supportsPointerEvent ? 'touch'
                    : isString(pointer.pointerType)
                    ? pointer.pointerType
                    : [, , 'touch', 'pen', 'mouse'][pointer.pointerType];
            }

            if (eventType === 'tap') {
                pointerEvent.dt = pointerEvent.timeStamp - this.downTimes[pointerIndex];

                interval = pointerEvent.timeStamp - this.tapTime;
                createNewDoubleTap = !!(this.prevTap && this.prevTap.type !== 'doubletap'
                && this.prevTap.target === pointerEvent.target
                && interval < 500);

                pointerEvent.double = createNewDoubleTap;

                this.tapTime = pointerEvent.timeStamp;
            }

            for (i = 0; i < targets.length; i++) {
                pointerEvent.currentTarget = elements[i];
                pointerEvent.interactable = targets[i];
                targets[i].fire(pointerEvent);

                if (pointerEvent.immediatePropagationStopped
                    || (pointerEvent.propagationStopped && elements[i + 1] !== pointerEvent.currentTarget)) {
                    break;
                }
            }

            if (createNewDoubleTap) {
                var doubleTap = {};

                extend(doubleTap, pointerEvent);

                doubleTap.dt = interval;
                doubleTap.type = 'doubletap';

                this.collectEventTargets(doubleTap, event, eventTarget, 'doubletap');

                this.prevTap = doubleTap;
            }
            else if (eventType === 'tap') {
                this.prevTap = pointerEvent;
            }
        },

        validateSelector: function (pointer, event, matches, matchElements) {
            for (var i = 0, len = matches.length; i < len; i++) {
                var match = matches[i],
                    matchElement = matchElements[i],
                    action = validateAction(match.getAction(pointer, event, this, matchElement), match);

                if (action && withinInteractionLimit(match, matchElement, action)) {
                    this.target = match;
                    this.element = matchElement;

                    return action;
                }
            }
        },

        setSnapping: function (pageCoords, status) {
            var snap = this.target.options[this.prepared.name].snap,
                targets = [],
                target,
                page,
                i;

            status = status || this.snapStatus;

            if (status.useStatusXY) {
                page = {x: status.x, y: status.y};
            }
            else {
                var origin = getOriginXY(this.target, this.element);

                page = extend({}, pageCoords);

                page.x -= origin.x;
                page.y -= origin.y;
            }

            status.realX = page.x;
            status.realY = page.y;

            page.x = page.x - this.inertiaStatus.resumeDx;
            page.y = page.y - this.inertiaStatus.resumeDy;

            var len = snap.targets ? snap.targets.length : 0;

            for (var relIndex = 0; relIndex < this.snapOffsets.length; relIndex++) {
                var relative = {
                    x: page.x - this.snapOffsets[relIndex].x,
                    y: page.y - this.snapOffsets[relIndex].y
                };

                for (i = 0; i < len; i++) {
                    if (isFunction(snap.targets[i])) {
                        target = snap.targets[i](relative.x, relative.y, this);
                    }
                    else {
                        target = snap.targets[i];
                    }

                    if (!target) {
                        continue;
                    }

                    targets.push({
                        x: isNumber(target.x) ? (target.x + this.snapOffsets[relIndex].x) : relative.x,
                        y: isNumber(target.y) ? (target.y + this.snapOffsets[relIndex].y) : relative.y,

                        range: isNumber(target.range) ? target.range : snap.range
                    });
                }
            }

            var closest = {
                target: null,
                inRange: false,
                distance: 0,
                range: 0,
                dx: 0,
                dy: 0
            };

            for (i = 0, len = targets.length; i < len; i++) {
                target = targets[i];

                var range = target.range,
                    dx = target.x - page.x,
                    dy = target.y - page.y,
                    distance = hypot(dx, dy),
                    inRange = distance <= range;

                // Infinite targets count as being out of range
                // compared to non infinite ones that are in range
                if (range === Infinity && closest.inRange && closest.range !== Infinity) {
                    inRange = false;
                }

                if (!closest.target || (inRange
                        // is the closest target in range?
                        ? (closest.inRange && range !== Infinity
                        // the pointer is relatively deeper in this target
                        ? distance / range < closest.distance / closest.range
                        // this target has Infinite range and the closest doesn't
                        : (range === Infinity && closest.range !== Infinity)
                        // OR this target is closer that the previous closest
                    || distance < closest.distance)
                        // The other is not in range and the pointer is closer to this target
                        : (!closest.inRange && distance < closest.distance))) {

                    if (range === Infinity) {
                        inRange = true;
                    }

                    closest.target = target;
                    closest.distance = distance;
                    closest.range = range;
                    closest.inRange = inRange;
                    closest.dx = dx;
                    closest.dy = dy;

                    status.range = range;
                }
            }

            var snapChanged;

            if (closest.target) {
                snapChanged = (status.snappedX !== closest.target.x || status.snappedY !== closest.target.y);

                status.snappedX = closest.target.x;
                status.snappedY = closest.target.y;
            }
            else {
                snapChanged = true;

                status.snappedX = NaN;
                status.snappedY = NaN;
            }

            status.dx = closest.dx;
            status.dy = closest.dy;

            status.changed = (snapChanged || (closest.inRange && !status.locked));
            status.locked = closest.inRange;

            return status;
        },

        setRestriction: function (pageCoords, status) {
            var target = this.target,
                restrict = target && target.options[this.prepared.name].restrict,
                restriction = restrict && restrict.restriction,
                page;

            if (!restriction) {
                return status;
            }

            status = status || this.restrictStatus;

            page = status.useStatusXY
                ? page = {x: status.x, y: status.y}
                : page = extend({}, pageCoords);

            if (status.snap && status.snap.locked) {
                page.x += status.snap.dx || 0;
                page.y += status.snap.dy || 0;
            }

            page.x -= this.inertiaStatus.resumeDx;
            page.y -= this.inertiaStatus.resumeDy;

            status.dx = 0;
            status.dy = 0;
            status.restricted = false;

            var rect, restrictedX, restrictedY;

            if (isString(restriction)) {
                if (restriction === 'parent') {
                    restriction = parentElement(this.element);
                }
                else if (restriction === 'self') {
                    restriction = target.getRect(this.element);
                }
                else {
                    restriction = closest(this.element, restriction);
                }

                if (!restriction) {
                    return status;
                }
            }

            if (isFunction(restriction)) {
                restriction = restriction(page.x, page.y, this.element);
            }

            if (isElement(restriction)) {
                restriction = getElementRect(restriction);
            }

            rect = restriction;

            if (!restriction) {
                restrictedX = page.x;
                restrictedY = page.y;
            }
            // object is assumed to have
            // x, y, width, height or
            // left, top, right, bottom
            else if ('x' in restriction && 'y' in restriction) {
                restrictedX = Math.max(Math.min(rect.x + rect.width - this.restrictOffset.right, page.x), rect.x + this.restrictOffset.left);
                restrictedY = Math.max(Math.min(rect.y + rect.height - this.restrictOffset.bottom, page.y), rect.y + this.restrictOffset.top);
            }
            else {
                restrictedX = Math.max(Math.min(rect.right - this.restrictOffset.right, page.x), rect.left + this.restrictOffset.left);
                restrictedY = Math.max(Math.min(rect.bottom - this.restrictOffset.bottom, page.y), rect.top + this.restrictOffset.top);
            }

            status.dx = restrictedX - page.x;
            status.dy = restrictedY - page.y;

            status.changed = status.restrictedX !== restrictedX || status.restrictedY !== restrictedY;
            status.restricted = !!(status.dx || status.dy);

            status.restrictedX = restrictedX;
            status.restrictedY = restrictedY;

            return status;
        },

        checkAndPreventDefault: function (event, interactable, element) {
            if (!(interactable = interactable || this.target)) {
                return;
            }

            var options = interactable.options,
                prevent = options.preventDefault;

            if (prevent === 'auto' && element && !/^(input|select|textarea)$/i.test(event.target.nodeName)) {
                // do not preventDefault on pointerdown if the prepared action is a drag
                // and dragging can only start from a certain direction - this allows
                // a touch to pan the viewport if a drag isn't in the right direction
                if (/down|start/i.test(event.type)
                    && this.prepared.name === 'drag' && options.drag.axis !== 'xy') {

                    return;
                }

                // with manualStart, only preventDefault while interacting
                if (options[this.prepared.name] && options[this.prepared.name].manualStart
                    && !this.interacting()) {
                    return;
                }

                event.preventDefault();
                return;
            }

            if (prevent === 'always') {
                event.preventDefault();
                return;
            }
        },

        calcInertia: function (status) {
            var inertiaOptions = this.target.options[this.prepared.name].inertia,
                lambda = inertiaOptions.resistance,
                inertiaDur = -Math.log(inertiaOptions.endSpeed / status.v0) / lambda;

            status.x0 = this.prevEvent.pageX;
            status.y0 = this.prevEvent.pageY;
            status.t0 = status.startEvent.timeStamp / 1000;
            status.sx = status.sy = 0;

            status.modifiedXe = status.xe = (status.vx0 - inertiaDur) / lambda;
            status.modifiedYe = status.ye = (status.vy0 - inertiaDur) / lambda;
            status.te = inertiaDur;

            status.lambda_v0 = lambda / status.v0;
            status.one_ve_v0 = 1 - inertiaOptions.endSpeed / status.v0;
        },

        autoScrollMove: function (pointer) {
            if (!(this.interacting()
                && checkAutoScroll(this.target, this.prepared.name))) {
                return;
            }

            if (this.inertiaStatus.active) {
                autoScroll.x = autoScroll.y = 0;
                return;
            }

            var top,
                right,
                bottom,
                left,
                options = this.target.options[this.prepared.name].autoScroll,
                container = options.container || getWindow(this.element);

            if (isWindow(container)) {
                left = pointer.clientX < autoScroll.margin;
                top = pointer.clientY < autoScroll.margin;
                right = pointer.clientX > container.innerWidth - autoScroll.margin;
                bottom = pointer.clientY > container.innerHeight - autoScroll.margin;
            }
            else {
                var rect = getElementClientRect(container);

                left = pointer.clientX < rect.left + autoScroll.margin;
                top = pointer.clientY < rect.top + autoScroll.margin;
                right = pointer.clientX > rect.right - autoScroll.margin;
                bottom = pointer.clientY > rect.bottom - autoScroll.margin;
            }

            autoScroll.x = (right ? 1 : left ? -1 : 0);
            autoScroll.y = (bottom ? 1 : top ? -1 : 0);

            if (!autoScroll.isScrolling) {
                // set the autoScroll properties to those of the target
                autoScroll.margin = options.margin;
                autoScroll.speed = options.speed;

                autoScroll.start(this);
            }
        },

        _updateEventTargets: function (target, currentTarget) {
            this._eventTarget = target;
            this._curEventTarget = currentTarget;
        }

    };

    function getInteractionFromPointer(pointer, eventType, eventTarget) {
        var i = 0, len = interactions.length,
            mouseEvent = (/mouse/i.test(pointer.pointerType || eventType)
                // MSPointerEvent.MSPOINTER_TYPE_MOUSE
            || pointer.pointerType === 4),
            interaction;

        var id = getPointerId(pointer);

        // try to resume inertia with a new pointer
        if (/down|start/i.test(eventType)) {
            for (i = 0; i < len; i++) {
                interaction = interactions[i];

                var element = eventTarget;

                if (interaction.inertiaStatus.active && interaction.target.options[interaction.prepared.name].inertia.allowResume
                    && (interaction.mouse === mouseEvent)) {
                    while (element) {
                        // if the element is the interaction element
                        if (element === interaction.element) {
                            return interaction;
                        }
                        element = parentElement(element);
                    }
                }
            }
        }

        // if it's a mouse interaction
        if (mouseEvent || !(supportsTouch || supportsPointerEvent)) {

            // find a mouse interaction that's not in inertia phase
            for (i = 0; i < len; i++) {
                if (interactions[i].mouse && !interactions[i].inertiaStatus.active) {
                    return interactions[i];
                }
            }

            // find any interaction specifically for mouse.
            // if the eventType is a mousedown, and inertia is active
            // ignore the interaction
            for (i = 0; i < len; i++) {
                if (interactions[i].mouse && !(/down/.test(eventType) && interactions[i].inertiaStatus.active)) {
                    return interaction;
                }
            }

            // create a new interaction for mouse
            interaction = new Interaction();
            interaction.mouse = true;

            return interaction;
        }

        // get interaction that has this pointer
        for (i = 0; i < len; i++) {
            if (contains(interactions[i].pointerIds, id)) {
                return interactions[i];
            }
        }

        // at this stage, a pointerUp should not return an interaction
        if (/up|end|out/i.test(eventType)) {
            return null;
        }

        // get first idle interaction
        for (i = 0; i < len; i++) {
            interaction = interactions[i];

            if ((!interaction.prepared.name || (interaction.target.options.gesture.enabled))
                && !interaction.interacting()
                && !(!mouseEvent && interaction.mouse)) {

                return interaction;
            }
        }

        return new Interaction();
    }

    function doOnInteractions(method) {
        return (function (event) {
            var interaction,
                eventTarget = getActualElement(event.path
                    ? event.path[0]
                    : event.target),
                curEventTarget = getActualElement(event.currentTarget),
                i;

            if (supportsTouch && /touch/.test(event.type)) {
                prevTouchTime = new Date().getTime();

                for (i = 0; i < event.changedTouches.length; i++) {
                    var pointer = event.changedTouches[i];

                    interaction = getInteractionFromPointer(pointer, event.type, eventTarget);

                    if (!interaction) {
                        continue;
                    }

                    interaction._updateEventTargets(eventTarget, curEventTarget);

                    interaction[method](pointer, event, eventTarget, curEventTarget);
                }
            }
            else {
                if (!supportsPointerEvent && /mouse/.test(event.type)) {
                    // ignore mouse events while touch interactions are active
                    for (i = 0; i < interactions.length; i++) {
                        if (!interactions[i].mouse && interactions[i].pointerIsDown) {
                            return;
                        }
                    }

                    // try to ignore mouse events that are simulated by the browser
                    // after a touch event
                    if (new Date().getTime() - prevTouchTime < 500) {
                        return;
                    }
                }

                interaction = getInteractionFromPointer(event, event.type, eventTarget);

                if (!interaction) {
                    return;
                }

                interaction._updateEventTargets(eventTarget, curEventTarget);

                interaction[method](event, event, eventTarget, curEventTarget);
            }
        });
    }

    function InteractEvent(interaction, event, action, phase, element, related) {
        var client,
            page,
            target = interaction.target,
            snapStatus = interaction.snapStatus,
            restrictStatus = interaction.restrictStatus,
            pointers = interaction.pointers,
            deltaSource = (target && target.options || defaultOptions).deltaSource,
            sourceX = deltaSource + 'X',
            sourceY = deltaSource + 'Y',
            options = target ? target.options : defaultOptions,
            origin = getOriginXY(target, element),
            starting = phase === 'start',
            ending = phase === 'end',
            coords = starting ? interaction.startCoords : interaction.curCoords;

        element = element || interaction.element;

        page = extend({}, coords.page);
        client = extend({}, coords.client);

        page.x -= origin.x;
        page.y -= origin.y;

        client.x -= origin.x;
        client.y -= origin.y;

        var relativePoints = options[action].snap && options[action].snap.relativePoints;

        if (checkSnap(target, action) && !(starting && relativePoints && relativePoints.length)) {
            this.snap = {
                range: snapStatus.range,
                locked: snapStatus.locked,
                x: snapStatus.snappedX,
                y: snapStatus.snappedY,
                realX: snapStatus.realX,
                realY: snapStatus.realY,
                dx: snapStatus.dx,
                dy: snapStatus.dy
            };

            if (snapStatus.locked) {
                page.x += snapStatus.dx;
                page.y += snapStatus.dy;
                client.x += snapStatus.dx;
                client.y += snapStatus.dy;
            }
        }

        if (checkRestrict(target, action) && !(starting && options[action].restrict.elementRect) && restrictStatus.restricted) {
            page.x += restrictStatus.dx;
            page.y += restrictStatus.dy;
            client.x += restrictStatus.dx;
            client.y += restrictStatus.dy;

            this.restrict = {
                dx: restrictStatus.dx,
                dy: restrictStatus.dy
            };
        }

        this.pageX = page.x;
        this.pageY = page.y;
        this.clientX = client.x;
        this.clientY = client.y;

        this.x0 = interaction.startCoords.page.x - origin.x;
        this.y0 = interaction.startCoords.page.y - origin.y;
        this.clientX0 = interaction.startCoords.client.x - origin.x;
        this.clientY0 = interaction.startCoords.client.y - origin.y;
        this.ctrlKey = event.ctrlKey;
        this.altKey = event.altKey;
        this.shiftKey = event.shiftKey;
        this.metaKey = event.metaKey;
        this.button = event.button;
        this.buttons = event.buttons;
        this.target = element;
        this.t0 = interaction.downTimes[0];
        this.type = action + (phase || '');

        this.interaction = interaction;
        this.interactable = target;

        var inertiaStatus = interaction.inertiaStatus;

        if (inertiaStatus.active) {
            this.detail = 'inertia';
        }

        if (related) {
            this.relatedTarget = related;
        }

        // end event dx, dy is difference between start and end points
        if (ending) {
            if (deltaSource === 'client') {
                this.dx = client.x - interaction.startCoords.client.x;
                this.dy = client.y - interaction.startCoords.client.y;
            }
            else {
                this.dx = page.x - interaction.startCoords.page.x;
                this.dy = page.y - interaction.startCoords.page.y;
            }
        }
        else if (starting) {
            this.dx = 0;
            this.dy = 0;
        }
        // copy properties from previousmove if starting inertia
        else if (phase === 'inertiastart') {
            this.dx = interaction.prevEvent.dx;
            this.dy = interaction.prevEvent.dy;
        }
        else {
            if (deltaSource === 'client') {
                this.dx = client.x - interaction.prevEvent.clientX;
                this.dy = client.y - interaction.prevEvent.clientY;
            }
            else {
                this.dx = page.x - interaction.prevEvent.pageX;
                this.dy = page.y - interaction.prevEvent.pageY;
            }
        }
        if (interaction.prevEvent && interaction.prevEvent.detail === 'inertia'
            && !inertiaStatus.active
            && options[action].inertia && options[action].inertia.zeroResumeDelta) {

            inertiaStatus.resumeDx += this.dx;
            inertiaStatus.resumeDy += this.dy;

            this.dx = this.dy = 0;
        }

        if (action === 'resize' && interaction.resizeAxes) {
            if (options.resize.square) {
                if (interaction.resizeAxes === 'y') {
                    this.dx = this.dy;
                }
                else {
                    this.dy = this.dx;
                }
                this.axes = 'xy';
            }
            else {
                this.axes = interaction.resizeAxes;

                if (interaction.resizeAxes === 'x') {
                    this.dy = 0;
                }
                else if (interaction.resizeAxes === 'y') {
                    this.dx = 0;
                }
            }
        }
        else if (action === 'gesture') {
            this.touches = [pointers[0], pointers[1]];

            if (starting) {
                this.distance = touchDistance(pointers, deltaSource);
                this.box = touchBBox(pointers);
                this.scale = 1;
                this.ds = 0;
                this.angle = touchAngle(pointers, undefined, deltaSource);
                this.da = 0;
            }
            else if (ending || event instanceof InteractEvent) {
                this.distance = interaction.prevEvent.distance;
                this.box = interaction.prevEvent.box;
                this.scale = interaction.prevEvent.scale;
                this.ds = this.scale - 1;
                this.angle = interaction.prevEvent.angle;
                this.da = this.angle - interaction.gesture.startAngle;
            }
            else {
                this.distance = touchDistance(pointers, deltaSource);
                this.box = touchBBox(pointers);
                this.scale = this.distance / interaction.gesture.startDistance;
                this.angle = touchAngle(pointers, interaction.gesture.prevAngle, deltaSource);

                this.ds = this.scale - interaction.gesture.prevScale;
                this.da = this.angle - interaction.gesture.prevAngle;
            }
        }

        if (starting) {
            this.timeStamp = interaction.downTimes[0];
            this.dt = 0;
            this.duration = 0;
            this.speed = 0;
            this.velocityX = 0;
            this.velocityY = 0;
        }
        else if (phase === 'inertiastart') {
            this.timeStamp = interaction.prevEvent.timeStamp;
            this.dt = interaction.prevEvent.dt;
            this.duration = interaction.prevEvent.duration;
            this.speed = interaction.prevEvent.speed;
            this.velocityX = interaction.prevEvent.velocityX;
            this.velocityY = interaction.prevEvent.velocityY;
        }
        else {
            this.timeStamp = new Date().getTime();
            this.dt = this.timeStamp - interaction.prevEvent.timeStamp;
            this.duration = this.timeStamp - interaction.downTimes[0];

            if (event instanceof InteractEvent) {
                var dx = this[sourceX] - interaction.prevEvent[sourceX],
                    dy = this[sourceY] - interaction.prevEvent[sourceY],
                    dt = this.dt / 1000;

                this.speed = hypot(dx, dy) / dt;
                this.velocityX = dx / dt;
                this.velocityY = dy / dt;
            }
            // if normal move or end event, use previous user event coords
            else {
                // speed and velocity in pixels per second
                this.speed = interaction.pointerDelta[deltaSource].speed;
                this.velocityX = interaction.pointerDelta[deltaSource].vx;
                this.velocityY = interaction.pointerDelta[deltaSource].vy;
            }
        }

        if ((ending || phase === 'inertiastart')
            && interaction.prevEvent.speed > 600 && this.timeStamp - interaction.prevEvent.timeStamp < 150) {

            var angle = 180 * Math.atan2(interaction.prevEvent.velocityY, interaction.prevEvent.velocityX) / Math.PI,
                overlap = 22.5;

            if (angle < 0) {
                angle += 360;
            }

            var left = 135 - overlap <= angle && angle < 225 + overlap,
                up = 225 - overlap <= angle && angle < 315 + overlap,

                right = !left && (315 - overlap <= angle || angle < 45 + overlap),
                down = !up && 45 - overlap <= angle && angle < 135 + overlap;

            this.swipe = {
                up: up,
                down: down,
                left: left,
                right: right,
                angle: angle,
                speed: interaction.prevEvent.speed,
                velocity: {
                    x: interaction.prevEvent.velocityX,
                    y: interaction.prevEvent.velocityY
                }
            };
        }
    }

    InteractEvent.prototype = {
        preventDefault: blank,
        stopImmediatePropagation: function () {
            this.immediatePropagationStopped = this.propagationStopped = true;
        },
        stopPropagation: function () {
            this.propagationStopped = true;
        }
    };

    function preventOriginalDefault() {
        this.originalEvent.preventDefault();
    }

    function getActionCursor(action) {
        var cursor = '';

        if (action.name === 'drag') {
            cursor = actionCursors.drag;
        }
        if (action.name === 'resize') {
            if (action.axis) {
                cursor = actionCursors[action.name + action.axis];
            }
            else if (action.edges) {
                var cursorKey = 'resize',
                    edgeNames = ['top', 'bottom', 'left', 'right'];

                for (var i = 0; i < 4; i++) {
                    if (action.edges[edgeNames[i]]) {
                        cursorKey += edgeNames[i];
                    }
                }

                cursor = actionCursors[cursorKey];
            }
        }

        return cursor;
    }

    function checkResizeEdge(name, value, page, element, interactableElement, rect, margin) {
        // false, '', undefined, null
        if (!value) {
            return false;
        }

        // true value, use pointer coords and element rect
        if (value === true) {
            // if dimensions are negative, "switch" edges
            var width = isNumber(rect.width) ? rect.width : rect.right - rect.left,
                height = isNumber(rect.height) ? rect.height : rect.bottom - rect.top;

            if (width < 0) {
                if (name === 'left') {
                    name = 'right';
                }
                else if (name === 'right') {
                    name = 'left';
                }
            }
            if (height < 0) {
                if (name === 'top') {
                    name = 'bottom';
                }
                else if (name === 'bottom') {
                    name = 'top';
                }
            }

            if (name === 'left') {
                return page.x < ((width >= 0 ? rect.left : rect.right ) + margin);
            }
            if (name === 'top') {
                return page.y < ((height >= 0 ? rect.top : rect.bottom) + margin);
            }

            if (name === 'right') {
                return page.x > ((width >= 0 ? rect.right : rect.left) - margin);
            }
            if (name === 'bottom') {
                return page.y > ((height >= 0 ? rect.bottom : rect.top ) - margin);
            }
        }

        // the remaining checks require an element
        if (!isElement(element)) {
            return false;
        }

        return isElement(value)
            // the value is an element to use as a resize handle
            ? value === element
            // otherwise check if element matches value as selector
            : matchesUpTo(element, value, interactableElement);
    }

    function defaultActionChecker(pointer, interaction, element) {
        var rect = this.getRect(element),
            shouldResize = false,
            action = null,
            resizeAxes = null,
            resizeEdges,
            page = extend({}, interaction.curCoords.page),
            options = this.options;

        if (!rect) {
            return null;
        }

        if (actionIsEnabled.resize && options.resize.enabled) {
            var resizeOptions = options.resize;

            resizeEdges = {
                left: false, right: false, top: false, bottom: false
            };

            // if using resize.edges
            if (isObject(resizeOptions.edges)) {
                for (var edge in resizeEdges) {
                    resizeEdges[edge] = checkResizeEdge(edge,
                        resizeOptions.edges[edge],
                        page,
                        interaction._eventTarget,
                        element,
                        rect,
                        resizeOptions.margin || margin);
                }

                resizeEdges.left = resizeEdges.left && !resizeEdges.right;
                resizeEdges.top = resizeEdges.top && !resizeEdges.bottom;

                shouldResize = resizeEdges.left || resizeEdges.right || resizeEdges.top || resizeEdges.bottom;
            }
            else {
                var right = options.resize.axis !== 'y' && page.x > (rect.right - margin),
                    bottom = options.resize.axis !== 'x' && page.y > (rect.bottom - margin);

                shouldResize = right || bottom;
                resizeAxes = (right ? 'x' : '') + (bottom ? 'y' : '');
            }
        }

        action = shouldResize
            ? 'resize'
            : actionIsEnabled.drag && options.drag.enabled
            ? 'drag'
            : null;

        if (actionIsEnabled.gesture
            && interaction.pointerIds.length >= 2
            && !(interaction.dragging || interaction.resizing)) {
            action = 'gesture';
        }

        if (action) {
            return {
                name: action,
                axis: resizeAxes,
                edges: resizeEdges
            };
        }

        return null;
    }

    // Check if action is enabled globally and the current target supports it
    // If so, return the validated action. Otherwise, return null
    function validateAction(action, interactable) {
        if (!isObject(action)) {
            return null;
        }

        var actionName = action.name,
            options = interactable.options;

        if ((  (actionName === 'resize' && options.resize.enabled )
            || (actionName === 'drag' && options.drag.enabled  )
            || (actionName === 'gesture' && options.gesture.enabled))
            && actionIsEnabled[actionName]) {

            if (actionName === 'resize' || actionName === 'resizeyx') {
                actionName = 'resizexy';
            }

            return action;
        }
        return null;
    }

    var listeners = {},
        interactionListeners = [
            'dragStart', 'dragMove', 'resizeStart', 'resizeMove', 'gestureStart', 'gestureMove',
            'pointerOver', 'pointerOut', 'pointerHover', 'selectorDown',
            'pointerDown', 'pointerMove', 'pointerUp', 'pointerCancel', 'pointerEnd',
            'addPointer', 'removePointer', 'recordPointer', 'autoScrollMove'
        ];

    for (var i = 0, len = interactionListeners.length; i < len; i++) {
        var name = interactionListeners[i];

        listeners[name] = doOnInteractions(name);
    }

    // bound to the interactable context when a DOM event
    // listener is added to a selector interactable
    function delegateListener(event, useCapture) {
        var fakeEvent = {},
            delegated = delegatedEvents[event.type],
            eventTarget = getActualElement(event.path
                ? event.path[0]
                : event.target),
            element = eventTarget;

        useCapture = useCapture ? true : false;

        // duplicate the event so that currentTarget can be changed
        for (var prop in event) {
            fakeEvent[prop] = event[prop];
        }

        fakeEvent.originalEvent = event;
        fakeEvent.preventDefault = preventOriginalDefault;

        // climb up document tree looking for selector matches
        while (isElement(element)) {
            for (var i = 0; i < delegated.selectors.length; i++) {
                var selector = delegated.selectors[i],
                    context = delegated.contexts[i];

                if (matchesSelector(element, selector)
                    && nodeContains(context, eventTarget)
                    && nodeContains(context, element)) {

                    var listeners = delegated.listeners[i];

                    fakeEvent.currentTarget = element;

                    for (var j = 0; j < listeners.length; j++) {
                        if (listeners[j][1] === useCapture) {
                            listeners[j][0](fakeEvent);
                        }
                    }
                }
            }

            element = parentElement(element);
        }
    }

    function delegateUseCapture(event) {
        return delegateListener.call(this, event, true);
    }

    interactables.indexOfElement = function indexOfElement(element, context) {
        context = context || document;

        for (var i = 0; i < this.length; i++) {
            var interactable = this[i];

            if ((interactable.selector === element
                && (interactable._context === context))
                || (!interactable.selector && interactable._element === element)) {

                return i;
            }
        }
        return -1;
    };

    interactables.get = function interactableGet(element, options) {
        return this[this.indexOfElement(element, options && options.context)];
    };

    interactables.forEachSelector = function (callback) {
        for (var i = 0; i < this.length; i++) {
            var interactable = this[i];

            if (!interactable.selector) {
                continue;
            }

            var ret = callback(interactable, interactable.selector, interactable._context, i, this);

            if (ret !== undefined) {
                return ret;
            }
        }
    };

    /*\
     * interact
     [ method ]
     *
     * The methods of this variable can be used to set elements as
     * interactables and also to change various default settings.
     *
     * Calling it as a function and passing an element or a valid CSS selector
     * string returns an Interactable object which has various methods to
     * configure it.
     *
     - element (Element | string) The HTML or SVG Element to interact with or CSS selector
     = (object) An @Interactable
     *
     > Usage
     | interact(document.getElementById('draggable')).draggable(true);
     |
     | var rectables = interact('rect');
     | rectables
     |     .gesturable(true)
     |     .on('gesturemove', function (event) {
     |         // something cool...
     |     })
     |     .autoScroll(true);
     \*/
    function interact(element, options) {
        return interactables.get(element, options) || new Interactable(element, options);
    }

    /*\
     * Interactable
     [ property ]
     **
     * Object type returned by @interact
     \*/
    function Interactable(element, options) {
        this._element = element;
        this._iEvents = this._iEvents || {};

        var _window;

        if (trySelector(element)) {
            this.selector = element;

            var context = options && options.context;

            _window = context ? getWindow(context) : window;

            if (context && (_window.Node
                    ? context instanceof _window.Node
                    : (isElement(context) || context === _window.document))) {

                this._context = context;
            }
        }
        else {
            _window = getWindow(element);

            if (isElement(element, _window)) {

                if (PointerEvent) {
                    events.add(this._element, pEventTypes.down, listeners.pointerDown);
                    events.add(this._element, pEventTypes.move, listeners.pointerHover);
                }
                else {
                    events.add(this._element, 'mousedown', listeners.pointerDown);
                    events.add(this._element, 'mousemove', listeners.pointerHover);
                    events.add(this._element, 'touchstart', listeners.pointerDown);
                    events.add(this._element, 'touchmove', listeners.pointerHover);
                }
            }
        }

        this._doc = _window.document;

        if (!contains(documents, this._doc)) {
            listenToDocument(this._doc);
        }

        interactables.push(this);

        this.set(options);
    }

    Interactable.prototype = {
        setOnEvents: function (action, phases) {
            if (action === 'drop') {
                if (isFunction(phases.ondrop)) {
                    this.ondrop = phases.ondrop;
                }
                if (isFunction(phases.ondropactivate)) {
                    this.ondropactivate = phases.ondropactivate;
                }
                if (isFunction(phases.ondropdeactivate)) {
                    this.ondropdeactivate = phases.ondropdeactivate;
                }
                if (isFunction(phases.ondragenter)) {
                    this.ondragenter = phases.ondragenter;
                }
                if (isFunction(phases.ondragleave)) {
                    this.ondragleave = phases.ondragleave;
                }
                if (isFunction(phases.ondropmove)) {
                    this.ondropmove = phases.ondropmove;
                }
            }
            else {
                action = 'on' + action;

                if (isFunction(phases.onstart)) {
                    this[action + 'start'] = phases.onstart;
                }
                if (isFunction(phases.onmove)) {
                    this[action + 'move'] = phases.onmove;
                }
                if (isFunction(phases.onend)) {
                    this[action + 'end'] = phases.onend;
                }
                if (isFunction(phases.oninertiastart)) {
                    this[action + 'inertiastart'] = phases.oninertiastart;
                }
            }

            return this;
        },

        /*\
         * Interactable.draggable
         [ method ]
         *
         * Gets or sets whether drag actions can be performed on the
         * Interactable
         *
         = (boolean) Indicates if this can be the target of drag events
         | var isDraggable = interact('ul li').draggable();
         * or
         - options (boolean | object) #optional true/false or An object with event listeners to be fired on drag events (object makes the Interactable draggable)
         = (object) This Interactable
         | interact(element).draggable({
         |     onstart: function (event) {},
         |     onmove : function (event) {},
         |     onend  : function (event) {},
         |
         |     // the axis in which the first movement must be
         |     // for the drag sequence to start
         |     // 'xy' by default - any direction
         |     axis: 'x' || 'y' || 'xy',
         |
         |     // max number of drags that can happen concurrently
         |     // with elements of this Interactable. Infinity by default
         |     max: Infinity,
         |
         |     // max number of drags that can target the same element+Interactable
         |     // 1 by default
         |     maxPerElement: 2
         | });
         \*/
        draggable: function (options) {
            if (isObject(options)) {
                this.options.drag.enabled = options.enabled === false ? false : true;
                this.setPerAction('drag', options);
                this.setOnEvents('drag', options);

                if (/^x$|^y$|^xy$/.test(options.axis)) {
                    this.options.drag.axis = options.axis;
                }
                else if (options.axis === null) {
                    delete this.options.drag.axis;
                }

                return this;
            }

            if (isBool(options)) {
                this.options.drag.enabled = options;

                return this;
            }

            return this.options.drag;
        },

        setPerAction: function (action, options) {
            // for all the default per-action options
            for (var option in options) {
                // if this option exists for this action
                if (option in defaultOptions[action]) {
                    // if the option in the options arg is an object value
                    if (isObject(options[option])) {
                        // duplicate the object
                        this.options[action][option] = extend(this.options[action][option] || {}, options[option]);

                        if (isObject(defaultOptions.perAction[option]) && 'enabled' in defaultOptions.perAction[option]) {
                            this.options[action][option].enabled = options[option].enabled === false ? false : true;
                        }
                    }
                    else if (isBool(options[option]) && isObject(defaultOptions.perAction[option])) {
                        this.options[action][option].enabled = options[option];
                    }
                    else if (options[option] !== undefined) {
                        // or if it's not undefined, do a plain assignment
                        this.options[action][option] = options[option];
                    }
                }
            }
        },

        /*\
         * Interactable.dropzone
         [ method ]
         *
         * Returns or sets whether elements can be dropped onto this
         * Interactable to trigger drop events
         *
         * Dropzones can receive the following events:
         *  - `dropactivate` and `dropdeactivate` when an acceptable drag starts and ends
         *  - `dragenter` and `dragleave` when a draggable enters and leaves the dropzone
         *  - `dragmove` when a draggable that has entered the dropzone is moved
         *  - `drop` when a draggable is dropped into this dropzone
         *
         *  Use the `accept` option to allow only elements that match the given CSS selector or element.
         *
         *  Use the `overlap` option to set how drops are checked for. The allowed values are:
         *   - `'pointer'`, the pointer must be over the dropzone (default)
         *   - `'center'`, the draggable element's center must be over the dropzone
         *   - a number from 0-1 which is the `(intersection area) / (draggable area)`.
         *       e.g. `0.5` for drop to happen when half of the area of the
         *       draggable is over the dropzone
         *
         - options (boolean | object | null) #optional The new value to be set.
         | interact('.drop').dropzone({
         |   accept: '.can-drop' || document.getElementById('single-drop'),
         |   overlap: 'pointer' || 'center' || zeroToOne
         | }
         = (boolean | object) The current setting or this Interactable
         \*/
        dropzone: function (options) {
            if (isObject(options)) {
                this.options.drop.enabled = options.enabled === false ? false : true;
                this.setOnEvents('drop', options);

                if (/^(pointer|center)$/.test(options.overlap)) {
                    this.options.drop.overlap = options.overlap;
                }
                else if (isNumber(options.overlap)) {
                    this.options.drop.overlap = Math.max(Math.min(1, options.overlap), 0);
                }
                if ('accept' in options) {
                    this.options.drop.accept = options.accept;
                }
                if ('checker' in options) {
                    this.options.drop.checker = options.checker;
                }

                return this;
            }

            if (isBool(options)) {
                this.options.drop.enabled = options;

                return this;
            }

            return this.options.drop;
        },

        dropCheck: function (dragEvent, event, draggable, draggableElement, dropElement, rect) {
            var dropped = false;

            // if the dropzone has no rect (eg. display: none)
            // call the custom dropChecker or just return false
            if (!(rect = rect || this.getRect(dropElement))) {
                return (this.options.drop.checker
                    ? this.options.drop.checker(dragEvent, event, dropped, this, dropElement, draggable, draggableElement)
                    : false);
            }

            var dropOverlap = this.options.drop.overlap;

            if (dropOverlap === 'pointer') {
                var page = getPageXY(dragEvent),
                    origin = getOriginXY(draggable, draggableElement),
                    horizontal,
                    vertical;

                page.x += origin.x;
                page.y += origin.y;

                horizontal = (page.x > rect.left) && (page.x < rect.right);
                vertical = (page.y > rect.top ) && (page.y < rect.bottom);

                dropped = horizontal && vertical;
            }

            var dragRect = draggable.getRect(draggableElement);

            if (dropOverlap === 'center') {
                var cx = dragRect.left + dragRect.width / 2,
                    cy = dragRect.top + dragRect.height / 2;

                dropped = cx >= rect.left && cx <= rect.right && cy >= rect.top && cy <= rect.bottom;
            }

            if (isNumber(dropOverlap)) {
                var overlapArea = (Math.max(0, Math.min(rect.right, dragRect.right) - Math.max(rect.left, dragRect.left))
                    * Math.max(0, Math.min(rect.bottom, dragRect.bottom) - Math.max(rect.top, dragRect.top))),
                    overlapRatio = overlapArea / (dragRect.width * dragRect.height);

                dropped = overlapRatio >= dropOverlap;
            }

            if (this.options.drop.checker) {
                dropped = this.options.drop.checker(dragEvent, event, dropped, this, dropElement, draggable, draggableElement);
            }

            return dropped;
        },

        /*\
         * Interactable.dropChecker
         [ method ]
         *
         * DEPRECATED. Use interactable.dropzone({ checker: function... }) instead.
         *
         * Gets or sets the function used to check if a dragged element is
         * over this Interactable.
         *
         - checker (function) #optional The function that will be called when checking for a drop
         = (Function | Interactable) The checker function or this Interactable
         *
         * The checker function takes the following arguments:
         *
         - dragEvent (InteractEvent) The related dragmove or dragend event
         - event (TouchEvent | PointerEvent | MouseEvent) The user move/up/end Event related to the dragEvent
         - dropped (boolean) The value from the default drop checker
         - dropzone (Interactable) The dropzone interactable
         - dropElement (Element) The dropzone element
         - draggable (Interactable) The Interactable being dragged
         - draggableElement (Element) The actual element that's being dragged
         *
         > Usage:
         | interact(target)
         | .dropChecker(function(dragEvent,         // related dragmove or dragend event
         |                       event,             // TouchEvent/PointerEvent/MouseEvent
         |                       dropped,           // bool result of the default checker
         |                       dropzone,          // dropzone Interactable
         |                       dropElement,       // dropzone elemnt
         |                       draggable,         // draggable Interactable
         |                       draggableElement) {// draggable element
         |
         |   return dropped && event.target.hasAttribute('allow-drop');
         | }
         \*/
        dropChecker: function (checker) {
            if (isFunction(checker)) {
                this.options.drop.checker = checker;

                return this;
            }
            if (checker === null) {
                delete this.options.getRect;

                return this;
            }

            return this.options.drop.checker;
        },

        /*\
         * Interactable.accept
         [ method ]
         *
         * Deprecated. add an `accept` property to the options object passed to
         * @Interactable.dropzone instead.
         *
         * Gets or sets the Element or CSS selector match that this
         * Interactable accepts if it is a dropzone.
         *
         - newValue (Element | string | null) #optional
         * If it is an Element, then only that element can be dropped into this dropzone.
         * If it is a string, the element being dragged must match it as a selector.
         * If it is null, the accept options is cleared - it accepts any element.
         *
         = (string | Element | null | Interactable) The current accept option if given `undefined` or this Interactable
         \*/
        accept: function (newValue) {
            if (isElement(newValue)) {
                this.options.drop.accept = newValue;

                return this;
            }

            // test if it is a valid CSS selector
            if (trySelector(newValue)) {
                this.options.drop.accept = newValue;

                return this;
            }

            if (newValue === null) {
                delete this.options.drop.accept;

                return this;
            }

            return this.options.drop.accept;
        },

        /*\
         * Interactable.resizable
         [ method ]
         *
         * Gets or sets whether resize actions can be performed on the
         * Interactable
         *
         = (boolean) Indicates if this can be the target of resize elements
         | var isResizeable = interact('input[type=text]').resizable();
         * or
         - options (boolean | object) #optional true/false or An object with event listeners to be fired on resize events (object makes the Interactable resizable)
         = (object) This Interactable
         | interact(element).resizable({
         |     onstart: function (event) {},
         |     onmove : function (event) {},
         |     onend  : function (event) {},
         |
         |     edges: {
         |       top   : true,       // Use pointer coords to check for resize.
         |       left  : false,      // Disable resizing from left edge.
         |       bottom: '.resize-s',// Resize if pointer target matches selector
         |       right : handleEl    // Resize if pointer target is the given Element
         |     },
         |
         |     // Width and height can be adjusted independently. When `true`, width and
         |     // height are adjusted at a 1:1 ratio.
         |     square: false,
         |
         |     // Width and height can be adjusted independently. When `true`, width and
         |     // height maintain the aspect ratio they had when resizing started.
         |     preserveAspectRatio: false,
         |
         |     // a value of 'none' will limit the resize rect to a minimum of 0x0
         |     // 'negate' will allow the rect to have negative width/height
         |     // 'reposition' will keep the width/height positive by swapping
         |     // the top and bottom edges and/or swapping the left and right edges
         |     invert: 'none' || 'negate' || 'reposition'
         |
         |     // limit multiple resizes.
         |     // See the explanation in the @Interactable.draggable example
         |     max: Infinity,
         |     maxPerElement: 1,
         | });
         \*/
        resizable: function (options) {
            if (isObject(options)) {
                this.options.resize.enabled = options.enabled === false ? false : true;
                this.setPerAction('resize', options);
                this.setOnEvents('resize', options);

                if (/^x$|^y$|^xy$/.test(options.axis)) {
                    this.options.resize.axis = options.axis;
                }
                else if (options.axis === null) {
                    this.options.resize.axis = defaultOptions.resize.axis;
                }

                if (isBool(options.preserveAspectRatio)) {
                    this.options.resize.preserveAspectRatio = options.preserveAspectRatio;
                }
                else if (isBool(options.square)) {
                    this.options.resize.square = options.square;
                }

                return this;
            }
            if (isBool(options)) {
                this.options.resize.enabled = options;

                return this;
            }
            return this.options.resize;
        },

        /*\
         * Interactable.squareResize
         [ method ]
         *
         * Deprecated. Add a `square: true || false` property to @Interactable.resizable instead
         *
         * Gets or sets whether resizing is forced 1:1 aspect
         *
         = (boolean) Current setting
         *
         * or
         *
         - newValue (boolean) #optional
         = (object) this Interactable
         \*/
        squareResize: function (newValue) {
            if (isBool(newValue)) {
                this.options.resize.square = newValue;

                return this;
            }

            if (newValue === null) {
                delete this.options.resize.square;

                return this;
            }

            return this.options.resize.square;
        },

        /*\
         * Interactable.gesturable
         [ method ]
         *
         * Gets or sets whether multitouch gestures can be performed on the
         * Interactable's element
         *
         = (boolean) Indicates if this can be the target of gesture events
         | var isGestureable = interact(element).gesturable();
         * or
         - options (boolean | object) #optional true/false or An object with event listeners to be fired on gesture events (makes the Interactable gesturable)
         = (object) this Interactable
         | interact(element).gesturable({
         |     onstart: function (event) {},
         |     onmove : function (event) {},
         |     onend  : function (event) {},
         |
         |     // limit multiple gestures.
         |     // See the explanation in @Interactable.draggable example
         |     max: Infinity,
         |     maxPerElement: 1,
         | });
         \*/
        gesturable: function (options) {
            if (isObject(options)) {
                this.options.gesture.enabled = options.enabled === false ? false : true;
                this.setPerAction('gesture', options);
                this.setOnEvents('gesture', options);

                return this;
            }

            if (isBool(options)) {
                this.options.gesture.enabled = options;

                return this;
            }

            return this.options.gesture;
        },

        /*\
         * Interactable.autoScroll
         [ method ]
         **
         * Deprecated. Add an `autoscroll` property to the options object
         * passed to @Interactable.draggable or @Interactable.resizable instead.
         *
         * Returns or sets whether dragging and resizing near the edges of the
         * window/container trigger autoScroll for this Interactable
         *
         = (object) Object with autoScroll properties
         *
         * or
         *
         - options (object | boolean) #optional
         * options can be:
         * - an object with margin, distance and interval properties,
         * - true or false to enable or disable autoScroll or
         = (Interactable) this Interactable
         \*/
        autoScroll: function (options) {
            if (isObject(options)) {
                options = extend({actions: ['drag', 'resize']}, options);
            }
            else if (isBool(options)) {
                options = {actions: ['drag', 'resize'], enabled: options};
            }

            return this.setOptions('autoScroll', options);
        },

        /*\
         * Interactable.snap
         [ method ]
         **
         * Deprecated. Add a `snap` property to the options object passed
         * to @Interactable.draggable or @Interactable.resizable instead.
         *
         * Returns or sets if and how action coordinates are snapped. By
         * default, snapping is relative to the pointer coordinates. You can
         * change this by setting the
         * [`elementOrigin`](https://github.com/taye/interact.js/pull/72).
         **
         = (boolean | object) **/

    }
});
