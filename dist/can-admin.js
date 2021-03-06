(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else {
        root.CanAdmin = factory();
    }
}(this, function () {
/**
 * @license almond 0.3.1 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                //Lop off the last part of baseParts, so that . matches the
                //"directory" and not name of the baseName's module. For instance,
                //baseName of "one/two/three", maps to "one/two/three.js", but we
                //want the directory, "one/two" for this normalization.
                name = baseParts.slice(0, baseParts.length - 1).concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {
        if (typeof name !== 'string') {
            throw new Error('See almond README: incorrect module build, no module name');
        }

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("../bower_components/almond/almond", function(){});

define('properties/base',[],function() {

/**
 * Wrapper for a simple property, can be initialized with just the name or a
 * dictionary of options
 * @param {string} key Name of the property in the model (optional, defaults
 *                      to "name")
 * @param {string} displayName Human-readable name (optional, defaults to key)
 * @param {function} widgetCallback Callback when widget is rendered
 *                      arguments: DOM node
 * @param {array} actions list of strings with supported actions (optional,
 *                        possible values: "create", "update")
 * @param {string} type reference to a admin type, either the Type or the name
 *                      of the type, necessary for creating mapped properties
 *                      inline (optional)
 * @return {can.Construct}
 */
    var Property = can.Construct.extend({
        defaults: {
            key: "name"
        }
    },{
        init: function(opts){
            if(typeof opts === "string"){
                opts = {key: opts}
            }
            opts = can.extend({}, this.constructor.defaults, opts)
            this.options = opts
        },
        getKey: function(){
            return this.options.key
        },
        getName: function(){
            return this.options.displayName || can.capitalize(this.getKey())
        },
        getType: function(){
            return this.options.type
        },
        setType: function(type){
            this.options.type = type
        },
        isEnabled: function(mode){
            if(this.options.actions){
                return can.inArray(mode, this.options.actions) !== -1
            }
            return !this.options.disabled
        },

        getDisplay: function(item, context){
            return  item[this.getKey()]
        },
        getWidget: function(item){
            return this.getDisplay(item)
        },
        widgetCallback: function(selector){
            var cb = this.options.widgetCallback
            if(typeof cb === "function"){
                window.setTimeout(function(){
                    cb(can.$(selector))
                })
            }
        },

        parseValue: function(val){
            return val
        }
    })

    return Property
})
;
define('properties/text-simple',[
    "./base"
], function(Base) {

/**
 * Wrapper for a simple property, can be initialized with just the name or a dictionary of options
 * @param {string} key Name of the property in the model (optional, defaults to "name")
 * @param {string} displayName Human-readable name (optional, defaults to key)
 * @param {function} widgetCallback Callback when widget is rendered, arguments: DOM node
 * @return {can.Construct}
 */
    var TextSimple = Base.extend({
        getWidget: function(item){
            this.widgetCallback("input[name='"+this.getKey()+"']")
            return can.view.render("../views/prop-input.stache", {
                name: this.getKey(),
                value: this.getDisplay(item)
            })

        }
    })

    return TextSimple
})
;
define('properties/text-long',[
    "./text-simple",
], function(TextSimple) {

/**
 * Property for a long text, renders a textare
 * @param {string} key Name of the property in the model (optional, defaults to "name")
 * @param {string} displayName Human-readable name (optional, defaults to key)
 * @param {function} widgetCallback Callback when widget is rendered, arguments: DOM node
 * @param {number} rows Size of the textarea
 * @return {can.Construct}
 */
    var TextLong = TextSimple.extend({
        getWidget: function(item){
            this.widgetCallback("textarea[name='"+this.getKey()+"']")
            return can.view.render("../views/prop-textarea.stache", {
                name: this.getKey(),
                value: this.getDisplay(item),
                rows: this.options.rows || 3
            })

        }
    })

    return TextLong
})
;
define('properties/select',[
    "./base"
],function(Base) {

/**
 * Wrapper for a vlue out of a list of pre-defined options, extends Base
 * @param {string} key Name of the property in the model
 * @param {string} displayName Human-readable name (optional, defaults to key)
 * @param {array} values List of objects describing options, attributes:
 *                        - value: the value to be saved
 *                        - name: name to be displayed
 * @return {can.Construct}
 */
    var Select = Base.extend({
        defaults: {
            displayProperty: "name"
        }
    },{
        getSelected: function(item){
            return item[this.getKey()]
        },

        getDisplay: function(item){
            var value = this.getSelected(item)
            var defined = can.grep(this.options.values, function(o){
                return o.value === value
            })
            return defined.length ?
                defined[0].name :
                can.capitalize(value)
        },
        getWidget: function(item){
            this.widgetCallback("select[name='"+this.getKey()+"']")
            var selected = this.getSelected(item)
            var options = can.map(this.options.values, function(opt){
                opt.selected = opt.value === selected
                return opt
            })
            return can.view.render("../views/prop-select.stache", {
                name: this.getKey(),
                multiple: this.options.multiple,
                options: options,
                displayProperty: this.options.displayProperty
            })
        }
    })

    return Select
})
;
define('properties/list',[
    "./select"
],function(Select) {

/**
 * Wrapper for a list of pre-defined options, extends Select
 * @param {string} key Name of the property in the model
 * @param {string} displayName Human-readable name (optional, defaults to key)
 * @param {array} values List of objects describing options, attributes:
 *                        - value: the value to be saved
 *                        - name: name to be displayed
 * @param {bool} multiple User can select multiple values
 * @return {can.Construct}
 */
    var List = Select.extend({
        isList: true,

        getSelected: function(item){
            return item[this.getKey()] || []
        },

        getDisplay: function(item){
            var names = []
            var opts = this.options.values
            can.each(this.getSelected(item), function(value){
                var defined = can.grep(opts, function(o){
                    return o.value === value
                })
                name.push(defined.length ?
                    defined[0].name :
                    can.capitalize(value)
                )
            })
            return names.join(", ")
        }
    })

    return List
})
;
define('properties/mapped',[
    "./base"
], function(Base) {

/**
 * Wrapper for a mapped property, extends Base, can be initialized with
 *     just the name or a dictionary of options
 * @param {string} key Name of the property in the model
 * @param {string} displayName Human-readable name (optional, defaults to key)
 * @param {string} displayProperty Name of the attribute of the mapped property
 *                          to use for display, can be a dotted path (optional,
 *                          defaults to "name")
 * @param {string} widgetType type of form element to use as widget, possible
 *                          values "select" (default) and "radio"
 * @param {function} widgetCallback Callback when widget is rendered, arguments: DOM node
 * @return {can.Construct}
 */
    var Mapped = Base.extend({
        defaults: {
            displayProperty: "name"
        }
    },{
        _asyncRenderValue: function(prop, item){
            var that = this
            if(prop){
                this.getOne(item, prop).done(function(mapped){
                    can.$("."+that._asyncReplaceClass(item))
                        .text(mapped.attr(that.getDisplayProperty()))
                })
            }
        },
        _asyncReplaceClass: function(item){
            var prop = this.getProperty(item)
            return prop ? this.getKey() + "-" + prop[prop.constructor.id] : this.getKey()
        },

        getDisplay: function(item, context){
            var val = this._asyncRenderValue(this.getProperty(item), item, context)
            return can.view.render("../views/prop-display.stache", {
                cssClass: this._asyncReplaceClass(item),
                val: val
            })
        },
        getPropertyID: function(prop){
            return prop[prop.constructor.id]
        },
        getSelectedId: function(item){
            var prop = this.getProperty(item)
            return prop ? this.getPropertyID(prop) : false
        },
        getWidgetTemplate: function(){
            if(this.options.widgetType === "radio") {
                return "../views/prop-radio.stache"
            }
            return "../views/prop-select.stache"
        },
        getWidget: function(item){
            this.viewParams = {
                name: this.getKey(),
                options: new can.List([]),
                cssClass: this._asyncReplaceClass(item),
                multiple: this.isList
            }

            var that = this
            this.getAll(item).done(function(all){
                var options = []
                all.forEach(function(opt){
                    options.push(that.prepareOptionForDisplay(opt, item))
                })
                that.viewParams.options.replace(options)
                that.widgetCallback("."+that._asyncReplaceClass(item))
            })

            var template = this.getWidgetTemplate()
            return can.view.render(template, this.viewParams)
        },
        addWidgetOption: function(item, option, selectedIds){
            this.viewParams.selected = selectedIds || this.viewParams.selected
            var displayOptions = this.prepareOptionForDisplay(option, item)
            displayOptions.selected = true
            this.viewParams.options.push(displayOptions)
            can.$("."+this._asyncReplaceClass(item)).trigger("change")
        },
        prepareOptionForDisplay: function(opt, item){
            var val = opt.constructor && opt.constructor.id ? opt[opt.constructor.id] : opt.value;
            var displayProperty = this.getDisplayProperty()
            var selectedIds = this.getSelectedId(item)
            return {
                value: val,
                displayName: displayProperty ? can.getObject(displayProperty, opt) : can.capitalize(val),
                selected: this.isList ?
                    can.inArray(val, selectedIds) !== -1 :
                    val === selectedIds
            }
        },

        getDisplayProperty: function(){
            return this.options.displayProperty  || "name"
        },

        getModel: function(item){
            if(item.constructor.attributes) {
                var modelName = item.constructor.attributes[this.getKey()].replace(/\.models?$/,"")
                return can.getObject(modelName, window)
            } else {
                var define = item.define[this.getKey()]
                var Type = define.Type || (define.type ? define.type().constructor : undefined)
                // return single Model if type is a Model.List
                return Type.Map || Type
            }
            
        },
        getProperty: function(item){
            return item[this.getKey()]
        },

        getOne: function(item, prop){
            return this.getModel(item).findOne({id: this.getPropertyID(prop)})
        },
        getAll: function(item){
            var params= {}
            var model = this.getModel(item)

            var type = this.getType()
            if(type){
                params = can.extend(
                    type.getQueryParameters("findAll"),
                    type.getPagingParameters(true)
                )
                if(type.sortParameter && type.sortProperty){
                    params[type.sortParameter] = type.sortProperty
                }
                model = type.model
            }
            if(this.options.queryParameters && this.options.queryParameters.findAll){
                can.extend(params, this.options.queryParameters.findAll)
            }
            return model.findAll(params)
        },

        parseValue: function(val){
            return {id: val}
        }
    })

    return Mapped
})
;
define('properties/list-mapped',[
    "./mapped"
], function(Mapped) {

/**
 * Wrapper for a list of mapped properties, extends PropertyMapped, can be
 *     initialized with just the name or a dictionary of options
 * @param {string} key Name of the property in the model
 * @param {string} displayName Human-readable name (optional, defaults to key)
 * @param {string} displayProperty Name of the attribute of the mapped property to
 *                          use for display (optional, defaults to "name")
 * @param {string} widgetType type of form element to use as widget, possible
 *                          values "select" (default) and "checkbox"
 * @param {function} widgetCallback Callback when widget is rendered, arguments: DOM node
 * @return {can.Construct}
 */
    var ListMapped = Mapped.extend({
        isList: true,

        _asyncRenderValue: function(props, item, context){
            if(context === "list"){
                // show count of values in list view
                return props ? props.length : 0
            } else {
                var that = this
                this.getAll(item)
                .done(function(mapList){
                    var names = props.map(function(prop){
                        return prop.attr(that.getDisplayProperty())
                    }).join(", ")
                    can.$("."+that._asyncReplaceClass(item)).text(names)
                })
            }
        },
        _asyncReplaceClass: function(item){
            var prop = this.getProperty(item)
            return prop ? prop.constructor.fullName + "-" + this.getKey() : this.getKey()
        },

        getWidgetTemplate: function(){
            if(this.options.widgetType === "checkbox") {
                return "../views/prop-list-checkbox.stache"
            }
            return "../views/prop-select.stache"
        },
        
        getSelectedId: function(item){
            var props = this.getProperty(item)
            var getID = this.getPropertyID
            return props ?
                    can.map(props, function(p){
                    return getID(p)
                }) :
                []
        }
    })

    return ListMapped
})
;
define('properties/list-mapped-one2one',[
    "./list-mapped"
],function(ListMapped) {

/**
 * Wrapper for a list of mapped properties from a one-to-one relationship,
 *     extends PropertyMapped
 * @param {string} key Name of the property in the model
 * @param {string} displayName Human-readable name (optional, defaults to key)
 * @param {string} displayProperty Name of the attribute of the mapped property to
 *                          use for display (optional, defaults to "name")
 * @param {function} widgetCallback Callback when widget is rendered, arguments: DOM node
 * @return {can.Construct}
 */
    var ListMappedOne2One = ListMapped.extend({

        getAll: function(item){
            var that = this
            var props = this.getProperty(item)
            var dfd = new can.Deferred()
            // if nothing is selected resolve immediately
            if(!props || !props.length){
                return dfd.resolve([])
            }
            var deferreds = can.map(props, function(prop){
                return that.getOne(item, prop)
            })

            can.when.apply(null, deferreds).done(function(){
                dfd.resolve(Array.prototype.slice.apply(arguments))
            })
            return dfd
        }
    })

    return ListMappedOne2One
})
;
define('properties/bool',[
    "./base"
], function(Base) {

/**
 * Wrapper for a boolean property, can be initialized with just the name or a
 *     dictionary of options, uses a checkbox as widget
 * @param {string} key Name of the property in the model
 * @param {string} displayName Human-readable name (optional, defaults to key)
 * @param {function} widgetCallback Callback when widget is rendered, arguments: DOM node
 * @param {string} value Value for boolean field if active
 * @return {can.Construct}
 */
    var Bool = Base.extend({
        defaults: {
            value: true
        }
    },{
        getDisplay: function(item){
            return this.isOn(item) ? "☑" : "☐"
        },
        getWidget: function(item){
            this.widgetCallback("input[name='"+this.getKey()+"']")
            return can.view.render("../views/prop-checkbox.stache", {
                name: this.getKey(),
                value: this.options.value,
                checked: this.isOn(item)
            })

        },

        isOn: function(item){
            return item[this.getKey()] === this.options.value
        }
    })

    return Bool
})
;
define('properties',[
    "./properties/text-simple",
    "./properties/text-long",
    "./properties/select",
    "./properties/list",
    "./properties/mapped",
    "./properties/list-mapped",
    "./properties/list-mapped-one2one",
    "./properties/bool"
], function(TextSimple, TextLong, Select, List, Mapped, ListMapped, ListMappedOne2One, Bool) {

    var Properties = {
        TextSimple: TextSimple,
        TextLong: TextLong,
        Select: Select,
        List: List,
        Mapped: Mapped,
        ListMapped: ListMapped,
        ListMappedOne2One: ListMappedOne2One,
        Bool: Bool
    }

    return Properties
})
;
(function(window) {
 can.view.preloadStringRenderer('views_admin_stache',can.stache("<div class=\"can-admin\">\n    <header>\n        <h2>Admin Area</h2>\n    </header>\n    <nav class=\"admin-breadcrumb\"></nav>\n    <nav class=\"admin-entities\">\n        <ul>\n            {{#types}}\n                {{#if isShowInMenu }}\n                <li>\n                    <a href=\"{{getRoute}}\">\n                        <i class=\"icon-{{getIcon}}\"></i>\n                        {{getNamePlural}}\n                    </a>\n                </li>\n                {{/if}}\n            {{/types}}\n        </ul>\n        {{#if pages}}\n        <hr>\n        <ul>\n            {{#pages}}\n                <li>\n                    <a href=\"{{getRoute}}\">\n                        <i class=\"icon-{{getIcon}}\"></i>\n                        {{getName}}\n                    </a>\n                </li>\n            {{/pages}}\n        </ul>\n        {{/if}}\n    </nav>\n    <div class=\"admin-content\"></div>\n</div>\n"));
can.view.preloadStringRenderer('views_breadcrumb_stache',can.stache("<a href=\"{{url}}\">{{text}}</a>\n"));
can.view.preloadStringRenderer('views_edit-inline_stache',can.stache("<div class=\"admin-edit-inline\">\n    <div class=\"admin-edit-overlay\">\n        <h2>{{type.getName}}</h2>\n        <div class=\"admin-edit-form\"></div>\n    </div>\n</div>\n"));
can.view.preloadStringRenderer('views_edit_stache',can.stache("<form class=\"form-horizontal\">\n    {{#each properties}}\n    <div class=\"control-group\">\n        <label class=\"control-label\" for=\"admin-edit-{{key}}\">{{label}}</label>\n        <div class=\"controls\">\n            <div {{appendDocFrag widget}}></div>\n            {{#if canCreate}}\n                <a {{data \"property\" property}} href=\"#\" class=\"admin-edit-create\">Create new</a>\n            {{/if}}\n        </div>\n    </div>\n    {{/each}}\n    {{#if canUpdate}}\n    <div class=\"control-group\">\n        <div class=\"controls\">\n            <button type=\"submit\" class=\"btn btn-primary\">Save</button>\n            {{#if inline}}\n            <button class=\"btn admin-edit-close\">Close</button>\n            {{/if}}\n        </div>\n    </div>\n    {{/if}}\n</form>\n"));
can.view.preloadStringRenderer('views_list_stache',can.stache("<header>\n    <h2>{{type.getNamePlural}}</h2>\n    {{#if canCreate}}\n        <a class=\"btn btn-primary\" href=\"{{type.getCreateRoute}}\"><i class=\"icon-plus\"></i> Create new</a>\n    {{/if}}\n    {{#if canSearch}}\n        <form class=\"form-search\">\n            <input type=\"text\" class=\"admin-list-search search-query\" placeholder=\"Search\">\n            <button type=\"reset\" class=\"btn admin-list-reset\">Clear</button>\n        </form>\n    {{/if}}\n</header>\n<table>\n    <tr>\n        {{#each type.list}}\n            <th>\n                {{#if options.orderBy}}\n                <a href=\"#\" class=\"sortable asc\" data-order-by=\"{{options.orderBy}}\">\n                    {{getName}}\n                </a>\n                {{else}}\n                    {{getName}}\n                {{/if}}\n            </th>\n        {{/each}}\n        {{#if canUpdate}}<th>Edit</th>{{/if}}\n        {{#if canDestroy}}<th>Delete</th>{{/if}}\n    </tr>\n    <tbody class=\"items\">\n        {{#each items}}\n        <tr {{data \"item\" item}} class=\"{{cssClass}}\">\n            <td>\n                <a href=\"{{route}}\">{{label}}</a>\n            </td>\n            {{#properties}}\n            <td {{appendDocFrag this}}>\n            </td>\n            {{/properties}}\n            {{#if canUpdate}}<td><a href=\"{{route}}\">Edit</a></td>{{/if}}\n            {{#if canDestroy}}<td><a href=\"#\" class=\"delete\">Delete</a></td>{{/if}}\n        </tr>\n        {{/each}}\n    </tbody>\n</table>\n<div class=\"admin-list-paging\"></div>\n"));
can.view.preloadStringRenderer('views_paginate_stache',can.stache("<div class=\"pagination\">\n  <ul>\n    <li class=\"{{#unless prev}}disabled{{/unless}}\">\n        {{#if prev}}\n            <a href=\"{{prev}}\" title=\"Previous Page\">&laquo;</a>\n        {{else}}<a>&laquo;</a>{{/if}}\n    </li>\n    {{#pages}}\n    <li class=\"{{#active}}active{{/active}}\">\n        <a href=\"{{url}}\">{{page}}</a>\n    </li>\n    {{/pages}}\n    <li class=\"{{#unless next}}disabled{{/unless}}\">\n        {{#if next}}\n            <a href=\"{{next}}\" title=\"Next Page\">&raquo;</a>\n        {{else}}<a>&raquo;</a>{{/if}}\n    </li>\n  </ul>\n</div>\n"));
can.view.preloadStringRenderer('views_prop-checkbox_stache',can.stache("<input type=\"checkbox\" value=\"{{value}}\" name=\"{{name}}\" id=\"admin-edit-{{name}}\"{{#checked}} checked{{/checked}}>\n"));
can.view.preloadStringRenderer('views_prop-display_stache',can.stache("<span class=\"{{cssClass}}\">{{val}}</span>\n"));
can.view.preloadStringRenderer('views_prop-input_stache',can.stache("<input type=\"text\" name=\"{{name}}\" id=\"admin-edit-{{name}}\" value=\"{{value}}\">\n"));
can.view.preloadStringRenderer('views_prop-list-checkbox_stache',can.stache("<div class=\"row-fluid admin-list-checkbox {{cssClass}}\">\n{{#each options}}\n    <label>\n        <input type=\"checkbox\" name=\"{{name}}\" value=\"{{value}}\"{{#selected}} checked{{/selected}}>\n        {{displayName}}\n    </label>\n{{/each}}\n</div>\n"));
can.view.preloadStringRenderer('views_prop-radio_stache',can.stache("<div class=\"{{cssClass}}\">\n{{#each options}}\n    <label>\n        <input type=\"radio\" name=\"{{name}}\" value=\"{{value}}\"{{#selected}} checked{{/selected}}>\n        {{displayName}}\n    </label>\n{{/each}}\n</div>\n"));
can.view.preloadStringRenderer('views_prop-select_stache',can.stache("<select class=\"{{cssClass}}\"\n    style=\"min-width: 220px; max-width: 600px;\"\n    id=\"admin-edit-{{name}}\"\n    name=\"{{name}}\"\n    {{#multiple}}multiple size=\'3\'{{/multiple}}>\n    {{#each options}}\n        <option value=\"{{value}}\"{{#selected}} selected{{/selected}}>\n            {{displayName}}\n        </option>\n    {{/each}}\n</select>\n"));
can.view.preloadStringRenderer('views_prop-textarea_stache',can.stache("<textarea class=\"{{cssClass}}\" id=\"admin-edit-{{name}}\" name=\"{{name}}\" rows=\"{{rows}}\">{{{value}}}</textarea>\n")); 
})(this);
define("views", function(){});

define('controls/list',[
    "../views"
], function() {

    var List = can.Control.extend({
        init: function(el, options) {
            this.items = new can.List([])
            this.renderPage()

            if(options.search){
                el.find(".admin-list-search").val(options.search)
                this.loadSearch(options.search)
            } else {
                this.loadPage(options.page)
            }

        },

        "{routes.list} route": function(route){
            if(route.type === this.options.type.name){
                this.loadPage()
            }
        },
        "{routes.listPage} route": function(route){
            this.loadPage(route.page)
        },
        "{routes.listSearch} route": function(route){
            this.loadSearch(route.search)
        },

        renderPage: function() {
            this.element.html(can.view("../views/list.stache", {
                type: this.options.type,
                canCreate: this.options.type.canCreate(),
                canSearch: this.options.type.canSearch(),
                canUpdate: this.options.type.canUpdate(),
                canDestroy: this.options.type.canDestroy(),
                items: this.items
            }))
        },

        loadPage: function(page){
            var that = this
            page = can.isNumeric(page) ? page : undefined
            this.options.type.getAll(page)
            .done(function(items){
                that.displayItems(items)
                that.initPaging(page)
                that.element.removeClass("admin-list-searchresults")
            })
        },

        displayItems: function(items){
            var properties = this.options.type.list
            var displayItems = []
            items.forEach(function(item, i){
                var displayItem = {
                    route: item.getRoute(),
                    label: item.getDisplay(properties[0], "list"),
                    properties: [],
                    cssClass: i%2 === 0 ? "even" : "odd",
                    item: item
                }
                properties.forEach(function(prop, i){
                    if(i > 0) {
                        displayItem.properties.push(item.getDisplay(prop, "list"))
                    }
                })
                displayItems.push(displayItem)
            })
            this.items.replace(displayItems)
        },

        initPaging: function(page){
            var opts = this.options.type.getPagingParameters()
            var lastPage = this.items.length !== opts.max
            if(!page && lastPage){
                // first page and less items found than allowed per page
                return
            }

            if(!this.hasOwnProperty("count")){
                this.count = this.options.type.getCount()
            }
            
            var that = this
            this.count.done(function(count){
                if(count <= opts.max || !that.element){
                    return
                }

                var route = that.options.routes.listPage
                var type = that.options.type.name
                page = parseInt(page) || 0
                var numPages = Math.floor(count/opts.max)
                var hasNext = count ?
                        page < numPages :
                        !lastPage

                var pages = []
                for(var p = 0; p <= numPages; p++){
                    if(numPages < 15 ||                     // display all pages if there are less than 15 or ...
                        (p > page - 4 && p < page + 4) ||   // display 3 pages before and after current page
                        (p + 1) % 10 === 0 ||               //   and every tenth page
                        p === 0 ||                          //   and the first
                        p === numPages -1                   //   and the last
                    ){
                        pages.push({
                            page: p+1,
                            active: page === p || !page && p === 0,
                            url: can.route.url({route: route, type: type, page: p})
                        })
                    }
                }

                that.element.find(".admin-list-paging").html(can.view("../views/paginate.stache", {
                    next: hasNext ? can.route.url({route: route, type: type, page: page + 1}) : undefined,
                    prev: page > 0 ? can.route.url({route: route, type: type, page: page - 1}) : undefined,
                    pages: pages
                }))
            })
        },

        loadSearch: function(q){
            this.element.addClass("admin-list-searchresults")
            var that = this
            this.options.type.getSearch(q).done(function(res){
                // ignore results if user was still typing while fetching results
                if(q === that.lastSearchTerm || !that.lastSearchTerm){
                    that.displayItems(res)
                }
            })
        },
        resetSearch: function(){
            window.location.hash = can.route.url({
                route: this.options.routes.list,
                type: this.options.type.name
            })
        },

        ".delete click": function(el, ev){
            ev.preventDefault()
            var row = el.closest("tr")
            var itemCompute = row.data("item")
            var item = itemCompute()
            if(window.confirm("Delete '" + item.getName() + "'?")){
                item.destroy()
                .done(function(){
                    row.remove()
                })
            }
        },

        ".admin-list-search keyup": function(el, ev){
            ev.preventDefault()
            var val = el.val()
            this.lastSearchTerm = val

            if(ev.which === 27){ // escape
                el.val("")
                this.resetSearch()
                return
            } else if(ev.which === 13) { // enter
                return
            }

            var that = this
            // wait 200ms before sending request to avoid searching while user is still typing
            window.setTimeout(function(){
                // only search if val didn't change
                if(val === that.lastSearchTerm){
                    window.location.hash = can.route.url({
                        route: that.options.routes.listSearch,
                        type: that.options.type.name,
                        search: val
                    })
                    that.element.find(".admin-list-paging").empty()
                }
            }, 200)
        },
        ".admin-list-reset click": function(el, ev){
            this.resetSearch()
        },

        ".sortable click": function(el, ev){
            ev.preventDefault()
            this.element.find(".sortable.active").removeClass("active")
            el.addClass("active").removeClass("desc asc")

            var orderBy = el.data("orderBy")
            var type = this.options.type
            if(orderBy !== type.sortProperty) {
                type.sortProperty = orderBy
                delete type.currentSortType
                el.addClass("asc")
            } else { // toggle sort direction
                if(!type.currentSortType || type.currentSortType === type.sortAscending){
                    type.currentSortType = type.sortDescending
                    el.addClass("desc")
                } else {
                    type.currentSortType = type.sortAscending
                    el.addClass("asc")
                }
            }
            
            this.loadPage()
        }
    })

    return List
})
;
define('controls/edit',[
    "../views"
], function() {

    var Edit = can.Control.extend({
        init: function(el, options) {
            // make deferred accessible so the invoking control can use item when it's loaded
            this.loadItem = can.when(options.id ? options.type.getOne(options.id) :  options.type.createNew())

            var that = this
            this.loadItem.done(function(item){
                that.item = item

                var target = that.options.inline ?
                    el.find(".admin-edit-form") :
                    el

                target.html(can.view("../views/edit.stache", {
                    type: options.type,
                    canUpdate: options.type.canUpdate(),
                    inline: options.inline,
                    item: item,
                    properties: that.getEditProperties()
                }))
            })
        },

        getEditProperties: function(){
            var properties = []
            var item = this.item
            this.options.type.edit.forEach(function(prop){
                if(!item.instance.isNew() || prop.isEnabled(item.instance.isNew() ? "create" : "update")) {
                    var propType = prop.getType()
                    properties.push({
                        key: prop.getKey(),
                        label: prop.getName(),
                        widget: item.getWidget(prop),
                        canCreate: propType ? propType.canCreate() : false,
                        property: prop
                    })
                }
            }, this)
            return properties
        },

        close: function(item){
            if(typeof this.options.onClose === "function"){
                this.options.onClose(item)
            }

            if(this.options.inline){
                this.element.remove()
            } else {
                window.location.hash = this.options.type.getRoute()
            }
        },

        "form submit": function(el, ev){
            ev.preventDefault()

            var dfd = this.item.saveForm(el)

            if(this.options.inline){
                var that = this
                dfd.done(function(item){
                    that.close(item)
                })
            }
        },

        ".admin-edit-create click": function(el, ev){
            ev.preventDefault()
            var property = el.data("property")
            var type = property.getType()
            var that = this

            this.element.after(can.view("../views/edit-inline.stache", {
                type: type
            }))

            var edit = new Edit(this.element.next(), {
                type: type,
                inline: true,
                onClose: function(newOption){
                    if(newOption){
                        // get currently selected items to prevent data loss when live-bound widgt list is re-drawn
                        var values = that.item.serializeForm(el.closest("form"))
                        var selectedIds = can.map(values[property.getKey()] || [], function(o){ return o.id })
                        // add new option and pre-select it
                        selectedIds.push(newOption.id)
                        property.addWidgetOption(that.item.instance, newOption, selectedIds)
                    }
                }
            })
        },

        ".admin-edit-close click": function(el, ev){
            ev.preventDefault()
            this.close()
        }
    })

    return Edit
})
;
define('controls/helpers',[], function() {
    can.stache.registerHelper("appendDocFrag",
        function(docFrag){
            return function(el) {
                if(docFrag instanceof Node) {
                    el.appendChild(docFrag)
                } else {
                    can.$(el).append(docFrag)
                }
            }
        })
})
;
define('controls/main',[
    "./list",
    "./edit",
    "./helpers",
    "../views"
], function(CtrlList, CtrlEdit) {

/**
 * Main control to initialize the Admin UI
 * @param {array} types List of Types to expose
 * @param {array} pages List of objects describing special Pages
 * @param {object} routes Dictionary with routes (optional)
 */

    var Main = can.Control.extend({
        defaults: {
            routes: {
                main: "admin",
                page: "admin/page/:page",
                list: "admin/list/:type",
                listPage: "admin/list/:type/page/:page",
                listSearch: "admin/list/:type/search/:search",
                create: "admin/list/:type/create",
                edit: "admin/list/:type/edit/:id"
            }
        }
    },{
        setup: function(el, options){
            var types = options.types || (this.constructor.defaults ? this.constructor.defaults.types : undefined)
            var routes = options.routes || this.constructor.defaults.routes
            if(types){
                types.forEach(function(type){
                    // pass routes configuration
                    type.routes = routes

                    // resolve other types referenced by name in properties
                    if(type.properties){
                        for(var key in type.properties){
                            var property = type.properties[key]
                            var typeName = property.getType()
                            if(typeName && typeof typeName === "string"){
                                var propType = this.getType(typeName, types)
                                property.setType(propType || undefined)
                            }
                        }
                    }
                }, this)
            }

            var pages = options.pages || (this.constructor.defaults ? this.constructor.defaults.pages : undefined)
            if(pages){
                pages.forEach(function(page){
                    // pass routes configuration
                    page.routes = routes
                })
            }
            can.Control.prototype.setup.call( this, el, options );
        },

        "{routes.main} route": "dashboard",
        "{routes.list} route": "list",
        "{routes.listPage} route": "list",
        "{routes.listSearch} route": "list",
        "{routes.create} route": "create",
        "{routes.edit} route": "edit",
        "{routes.page} route": "page",

        init: function(){
            this.initHtml()
            can.route.ready()
        },

        initHtml: function(){
            this.element.html(can.view("../views/admin.stache", {
                types: this.options.types,
                pages: this.options.pages
            }))
        },
        dashboard: function(){
            this.breadcrumb()
        },
        list: function(route){
            if(this.currentList === route.type){
                return
            }
            this.breadcrumb()
            this.currentList = route.type
            var ctrl = new CtrlList(this.element.find(".admin-content"), can.extend(route, {
                type: this.getType(route.type),
                routes: this.options.routes
            }))
        },
        create: function(route){
            this.breadcrumb()
            var ctrl = new CtrlEdit(this.element.find(".admin-content"), {
                type: this.getType(route.type)
            })
        },
        edit: function(route){
            this.breadcrumb()
            var control = new CtrlEdit(this.element.find(".admin-content"), {
                type: this.getType(route.type),
                id: route.id
            })
            var that = this
            control.loadItem.done(function(item){
                that.appendToBreadcrumb(item.getName(), item.getRoute())
            })
        },
        page: function(route){
            this.breadcrumb()
            var page = this.getPage(route.page)
            page.initControl(this.element.find(".admin-content"))
        },

        getType: function(name, types){
            types = types || this.options.types
            return can.grep(types, function(type){
                return type.name === name
            })[0]
        },

        getPage: function(name){
            return can.grep(this.options.pages, function(page){
                return page.name === name
            })[0]
        },

        breadcrumb: function(){
            delete this.currentList
            if(!this.element.find(".admin-breadcrumb").empty().length){
                this.initHtml()
            }
            this.element.find(".admin-content").replaceWith("<div class='admin-content'></div>")
            this.appendToBreadcrumb("Admin", can.route.url({route: this.options.routes.main}))

            // append type to breadcrumb
            var route = can.route.attr()
            if(route.type){
                var type = this.getType(route.type)
                this.appendToBreadcrumb(type.getName(), type.getRoute())
            } else if(route.page){
                var page = this.getPage(route.page)
                this.appendToBreadcrumb(page.getName(), page.getRoute())
            }
        },
        appendToBreadcrumb: function(text, url){
            this.element.find(".admin-breadcrumb").append(can.view("../views/breadcrumb.stache", {
                url: url,
                text: text
            }))
        }
    })

    return Main
    
})
;
define('controls',[
    "./controls/main",
    "./controls/list",
    "./controls/edit"
], function(Main, List, Edit) {

    var Controls = {
        Main: Main,
        List: List,
        Edit: Edit
    }

    return Controls
})
;
define('item',[],function() {

/**
 * Instance of an entity
 * @param {Type} type The Type construct the instance belongs to
 * @param {can.Model} instance Instance of a model
 * @param {string} displayProperty name of the property to use for display,
 *                                 can be a dotted path (optional, defaults
 *                                 to "name")
 * @return {can.Construct}
 */
    var Item = can.Construct.extend({
        init: function(opts){
            for(var o in opts){
                this[o] = opts[o]
            }
        },

        getName: function(){
            var propName = this.displayProperty || this.type.displayProperty || "name"
            var prop = can.getObject(propName, this.type.properties)
            return this.getDisplay(prop)
        },

        getRoute: function(){
            return can.route.url({
                route: this.type.routes.edit,
                type: this.type.name,
                id: this.instance[this.instance.constructor.id || "id"]
            })
        },

        getDisplay: function(property, context){
            return property.getDisplay(this.instance, context)
        },
        getWidget: function(property){
            var mode = this.instance.isNew() ? "create" : "update"
            return !this.type.canUpdate() || !property.isEnabled(mode) ?
                can.$("<span class='ro-property'></span>").append(this.getDisplay(property, "edit")) :
                property.getWidget(this.instance)
        },

        serializeForm: function(form){
            var objects = form.serializeArray();
            var result = {}
            objects.forEach(function(obj){
                var prop = this.type.getProperty(obj.name)
                var val = prop.parseValue(obj.value)
                if(prop && prop.isList){
                    result[obj.name] = result[obj.name] || []
                    result[obj.name].push(val)
                } else {
                    result[obj.name] = val
                }
            }, this)
            return result;
        },
        save: function(updatedValues){
            this.type.edit.forEach(function(property){
                var val = updatedValues[property.getKey()]
                var key = property.getKey()

                if(val === undefined){
                    this.instance.removeAttr(key)
                } else {
                    this.instance.attr(key, val)
                }
            }, this)
            var save = this.instance.save()
            if (this.instance.isNew()) {
                this.callback(save, "onCreate");
            } else {
                this.callback(save, "onUpdate");
            }
            this.callback(save, "onError", "fail");
            return save;
        },
        saveForm: function(form){
            return this.save(this.serializeForm(form))
        },
        destroy: function(){
            var destroy =  this.instance.destroy()
            this.callback(destroy, "onDestroy");
            this.callback(destroy, "onError", "fail");
            return destroy
        },

        callback: function(deferred, name, when) {
            if (this.type.callbacks) {
                var cb = this.type.callbacks[name];
                when = when || "done"
                if (typeof cb === "function") {
                    deferred[when](cb);
                }
            }
        }
    })

    return Item
})
;
define('type',[
    "./item"
], function(Item) {

/**
 * Base type for admin UI
 * @param {string} name Machine-readable name
 * @param {string} displayName Human-readable name (optional, defaults to @name)
 * @param {string} displayNamePlural Human-readable plural name (optional,
 *                        defaults to @name)
 * @param {string} displayProperty Name of the property of an item to use
 *                        for display (optional)
 * @param {string} icon Name of CSS class for icon, without "icon-" prefix
 *                        (optional, defaults to "cog")
 * @param {bool, func} showInMenu controls if type is listed in menu. Useful
                          to include types which are only used as property of
                          another type but shouldn't show up in menu. (optional,
                          default true)
 * @param {can.Model} model the can.Model connecting the type to a REST service
 * @param {object} properties Dictionary of properties of the model which are
 *                        used in the Admin UI
 * @param {array} list Array of property names to be displayed in the list of
 *                        entities (optional, defaults to first element of
 *                        @edit)
 * @param {array} edit Array of property names to edited (optional, as default
 *                        all @properties are editable)
 * @param {array} actions list of strings with supported actions (optional,
 *                        defaults to ["create", "update", "destroy"])
 * @param {array} callbacks list of functions called in the success method of
 *                        the corresponding model call: "onCreate", "onUpdate",
 *                        "onDestroy", "onError" (called on all errors)
 * @param {object} paging Object describing parameters for paging:
 *                        - limit: name of the property limiting the number
 *                          of item per page (optional, defaults to "limit")
 *                        - offset: name of the property defining the current
 *                          paging position (optional, defaults to "offset")
 *                        - n: number of entities to display per page (optional,
 *                          defaults to 25)
 *                        - noLimit: value to use for limit when retrieving
 *                          all entities (optional, default: 0)
 * @param {string} sortParameter Name of query parameter to define sorting
 *                        (optional, default "orderBy")
 * @param {string} sortProperty Name of property to sort by (optional)
 * @param {string} sortType Name of query parameter to define ascending/
 *                        descending sort order (optional, default "orderType")
 * @param {string} sortAscending Query value for ascending sorting (optional,
 *                        default "ASC")
 * @param {string} sortDescending Query value for ascending sorting (optional,
 *                        default "DESC")
 * @param {object} queryParameters Dictionary with parameters to append to
 *                        findOne, findAll and getCount queries, e.g.:
 *                        {findAll: { filter: "USER"} } will append
 *                            ?filter=USER to all findAll requests
 * @param {object} services Object configuring additional services not covered
 *                        by model:
 *                        - count: URL or function to retrieve count of items
 *                        - search: URL or function providing a search interface
 * @return {can.Construct}
 */
    var Type = can.Construct.extend({
        defaults: {
            actions: ["create", "update", "destroy"],
            icon: "cog",
            paging: {
                limit: "limit",
                offset: "offset",
                n: 25,
                noLimit: 0
            },
            sortParameter: "orderBy",
            sortType: "orderType",
            sortAscending: "ASC",
            sortDescending: "DESC",
            showInMenu: true
        }
    },{
        init: function(opts){
            opts = can.extend({}, this.constructor.defaults, opts)
            var getProperty = function(propName){
                return opts.properties[propName]
            }
            var createService = function(s){
                switch (typeof s) {
                    case "function":
                        return s
                    case "string":
                        return function(params){
                            return can.getJSON(can.sub(s, params, false))
                        }
                }
                throw  "No valid service definition " + s
            }

            // store all opts in instance, set properties for list and edit:
            for(var o in opts){
                if(o === "edit" || o === "list"){
                    this[o] = can.map(opts[o], getProperty)
                } else if(o === "services"){
                    this.services = {}
                    for(var s in opts.services){
                        this.services[s] = createService(opts.services[s])
                    }
                } else {
                    this[o] = opts[o]
                }
            }

            // if no editable properties are defined, assume all properties are editable:
            this.edit = this.edit || can.map(opts.properties, function(n){ return n })

            // if no properties for list view are defined, use first property from edit:
            this.list = this.list || [this.edit[0]]
        },

        canCreate: function(){
            return this.supportsAction("create")
        },
        canUpdate: function(){
            return this.supportsAction("update")
        },
        canDestroy: function(){
            return this.supportsAction("destroy")
        },
        supportsAction: function(action){
            return can.inArray(action, this.actions) !== -1
        },
        canSearch: function(){
            return !! (this.services && this.services.search)
        },

        getName: function(){
            return this.displayName || can.capitalize(this.name)
        },
        getNamePlural: function(){
            return this.displayNamePlural || this.getName() + "s"
        },
        isShowInMenu: function(){
            return typeof this.showInMenu === "function" ?
                this.showInMenu() :
                !!this.showInMenu
        },

        getIcon: function(){
            return this.icon
        },

        _route: function(what){
            return can.route.url({
                route: this.routes[what],
                type: this.name
            })
        },
        getRoute: function(){
            return this._route("list")
        },
        getCreateRoute: function(){
            return this._route("create")
        },

        getProperty: function(key){
            for(var prop in this.properties){
                if(this.properties[prop].getKey() === key){
                    return this.properties[prop]
                }
            }
        },

        getPagingParameters: function(page){
            page = page || 0
            var that = this
            var get = function(name){
                return that.paging && that.paging[name] !== undefined ?
                    that.paging[name] :
                    that.constructor.defaults.paging[name]
            }

            var opts = {}
            if(page === true){
                opts[get("limit")] = get("noLimit")
            } else {
                var n = get("n")
                opts[get("limit")] = n
                opts[get("offset")] = n * page
            }
            return opts
        },
        getQueryParameters: function(query){
            return this.queryParameters ? this.queryParameters[query] || {} : {}
        },

        getAll: function(page){
            var params = can.extend(
                this.getQueryParameters("findAll"),
                this.getPagingParameters(page)
                )
            if(this.sortParameter && this.sortProperty){
                params[this.sortParameter] = this.sortProperty
                if(this.currentSortType){
                    params[this.sortType] = this.currentSortType
                }
            }

            return this.returnItemList(this.model.findAll(params))
        },
        returnItemList: function(deferred){
            var that = this
            return deferred.then(function(instances){
                    return can.map(instances, function(instance){
                        if(!(instance instanceof that.model)) {
                            instance = new that.model(instance)
                        }
                        return new Item({
                            type: that,
                            instance: instance
                        })
                    })
                })
        },
        getOne: function(id){
            var that = this
            var params = this.getQueryParameters("findOne")
            params.id = id
            return this.model.findOne(params)
                .then(function(instance){
                    return new Item({
                        type: that,
                        instance: instance
                    })
                })
        },
        createNew: function(){
            var instance = new this.model()
            return new Item({
                type: this,
                instance: instance
            })
        },
        getCount: function(){
            if(this.services && this.services.count){
                return this.services.count(this.getQueryParameters("count"))
            }
            return new can.Deferred().resolve()
        },
        getSearch: function(term){
            if(this.canSearch()){
                var params = can.extend({},
                    this.getPagingParameters(0),
                    this.getQueryParameters("search"),
                    {
                        s: term
                    })
                return this.returnItemList(this.services.search(params))
            }
            return new can.Deferred().resolve()
        }
    })

    return Type
})
;
define('page',[],function() {

/**
 * Pages provide a possibility to run custom Controls in the admin area
 * @param {string} name Machine-readable name
 * @param {string} displayName Human-readable name (optional, defaults to @name)
 * @param {string} icon Name of CSS class for icon, without "icon-" prefix
 *                        (optional, defaults to "cog")
 * @param {object} routes Dictionary with routes
 * @param {can.Control} control Controller to be initialized for page
 *
 * @return {can.Contruct}
 */
    var Page = can.Construct.extend({
        defaults: {
            icon: "cog"
        }
    },{
        init: function(opts){
            opts = can.extend({}, this.constructor.defaults, opts)

            for(var o in opts){
                this[o] = opts[o]
            }
        },
        getRoute: function(){
            return can.route.url({
                route: this.routes.page,
                page: this.name
            })
        },
        getName: function(){
            return this.displayName || can.capitalize(this.name)
        },
        getIcon: function(){
            return this.icon
        },

        initControl: function(el){
            return new this.control(el, this.controlOptions)
        }
    })

    return Page
})
;
define('admin',[
    "./properties",
    "./controls",
    "./type",
    "./page"
], function(Properties, Controls, Type, Page) {
    return {
        Properties: Properties,
        Controls: Controls,
        Type: Type,
        Page: Page
    }
})
;
    return require('admin');
}));
