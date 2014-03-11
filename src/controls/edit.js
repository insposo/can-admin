define([
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

                target.html(can.view("../views/admin-edit.ejs", {
                    type: options.type,
                    inline: options.inline,
                    item: item
                }))
            })
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

            this.item.saveForm(el)
        },

        ".admin-edit-create click": function(el, ev){
            ev.preventDefault()
            var property = el.data("property")
            var type = property.getType()
            var that = this

            this.element.after(can.view("../views/admin-edit-inline.ejs", {
                type: type
            }))

            var edit = new Edit(this.element.next(), {
                type: type,
                inline: true,
                onClose: function(newOption){
                    if(newOption){
                        // get currently selected items to prevent data loss when live-bound widgt list is re-drawn
                        var values = that.item.serializeForm(el.closest("form"))
                        var selectedIds = can.map(values[property.getKey()], function(o){ return o.id })
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