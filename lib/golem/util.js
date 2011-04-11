var time        = {};
    time.SECOND = 1000;
    time.MINUTE = time.SECOND * 60;
    time.HOUR   = time.MINUTE * 60;
    time.DAY    = time.HOUR   * 24;

this.clone = function (obj) {
    var clone = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i ++) {
        clone[keys[i]] = obj[keys[i]];
    }
    return clone;
};

this.merge = function (/* object... */) {
    var target = {},
        objs   = Array.prototype.slice.call(arguments, 1);

    objs.forEach(function(o) {
        Object.keys(o).forEach(function (attr) {
            if (! o.__lookupGetter__(attr)) {
                target[attr] = o[attr];
            }
        });
    });
    return target;
};

this.duration = function (ms) {
    var stringify = function (type, caption) {
        var amount = Math.round(ms / type);
        return amount + ' ' + caption + (amount > 1 ? 's': '');
    };

    if (ms > time.DAY) {
        return stringify(time.DAY, 'day');
    } else if (ms > time.HOUR) {
        return stringify(time.HOUR, 'hour');
    } else if (ms > time.MINUTE) {
        return stringify(time.MINUTE, 'minute');
    } else if (ms > time.SECOND) {
        return stringify(time.SECOND, 'second');
    } else if (ms < 0) {
        return null;
    }
};

this.size = function (bytes) {
    if (bytes > 1024 * 1024) {
        return Math.round(bytes / (1024 * 1024)) + 'M';
    } else if (bytes > 1024) {
        return Math.round(bytes / (1024)) + 'K';
    } else {
        return bytes;
    }
};

this.memoryUsage = function () {
    var usage = process.memoryUsage();

    return {
        rss: util.size(usage.rss),
        vsize: util.size(usage.vsize),
        heapTotal: util.size(usage.heapTotal),
        heapUsed: util.size(usage.heapUsed)
    };
};

