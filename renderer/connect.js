(function () {
    var svg, connections = [], pendingFrom = null;
    var mouseX = 0, mouseY = 0, tempPath = null;

    window.addEventListener('DOMContentLoaded', function () {
        setupSVG();
        setupNodes();
        drawAutoConns();
        requestAnimationFrame(tick);
    });

    function setupSVG() {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'conn-svg';
        svg.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:500;overflow:visible;';

        var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        defs.appendChild(makeMarker('arr', '#aaa'));
        defs.appendChild(makeMarker('arr-temp', '#888'));
        svg.appendChild(defs);
        document.body.appendChild(svg);

        document.addEventListener('mousemove', function (e) {
            mouseX = e.clientX;
            mouseY = e.clientY;
        });

        document.addEventListener('click', function (e) {
            if (pendingFrom && !e.target.classList.contains('conn-dot')) {
                clearPending();
            }
        });
    }

    function makeMarker(id, color) {
        var marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', id);
        marker.setAttribute('markerWidth', '8');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('refX', '8');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        poly.setAttribute('points', '0 0, 8 3, 0 6');
        poly.setAttribute('fill', color);
        marker.appendChild(poly);
        return marker;
    }

    function setupNodes() {
        document.querySelectorAll('p.process').forEach(addDots);
        document.querySelectorAll('li.d').forEach(addDots);
        document.querySelectorAll('div.endflow').forEach(addDots);
        document.querySelectorAll('.proc-doc').forEach(addDots);
        document.querySelectorAll('.proc-file').forEach(addDots);
        document.querySelectorAll('.proc-db').forEach(addDots);
    }

    function getConnEl(id) {
        var li = document.getElementById(String(id));
        if (!li) return null;
        if (li.classList.contains('d')) return li;
        var proc = li.querySelector('p.process');
        if (proc) return proc;
        var ef = li.querySelector('div.endflow');
        if (ef) return ef;
        var pd = li.querySelector('.proc-doc');
        if (pd) return pd;
        var pf = li.querySelector('.proc-file');
        if (pf) return pf;
        var pdb = li.querySelector('.proc-db');
        if (pdb) return pdb;
        return li;
    }

    function drawAutoConns() {
        var list = window._autoConns || [];
        list.forEach(function (c) {
            var fromEl = getConnEl(c.fromId);
            var toEl   = getConnEl(c.toId);
            if (!fromEl || !toEl) return;
            var path = makePath(false);
            svg.appendChild(path);
            connections.push({ from: fromEl, fromSide: c.fromSide, to: toEl, toSide: c.toSide, path: path });
        });
    }

    function addDots(el) {
        if (el.dataset.hasConn) return;
        el.dataset.hasConn = 'true';

        ['top', 'right', 'bottom', 'left'].forEach(function (side) {
            var dot = document.createElement('div');
            dot.className = 'conn-dot conn-dot-' + side;
            dot.dataset.side = side;
            el.appendChild(dot);

            dot.addEventListener('click', function (e) {
                e.stopPropagation();
                handleDotClick(el, side, dot);
            });
        });
    }

    function handleDotClick(el, side, dot) {
        if (!pendingFrom) {
            pendingFrom = { el: el, side: side, dot: dot };
            dot.style.opacity = '1';
            dot.style.background = '#ff6b35';
            dot.style.boxShadow = '0 0 6px rgba(255,107,53,0.6)';
            tempPath = makePath(true);
            svg.appendChild(tempPath);
        } else {
            if (pendingFrom.el === el) { clearPending(); return; }
            var path = makePath(false);
            svg.appendChild(path);

            var conn = { from: pendingFrom.el, fromSide: pendingFrom.side, to: el, toSide: side, path: path };
            connections.push(conn);

            path.style.pointerEvents = 'stroke';
            path.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                svg.removeChild(path);
                connections = connections.filter(function (c) { return c.path !== path; });
            });

            clearPending();
        }
    }

    function clearPending() {
        if (pendingFrom) {
            pendingFrom.dot.style.opacity = '';
            pendingFrom.dot.style.background = '';
            pendingFrom.dot.style.boxShadow = '';
            pendingFrom = null;
        }
        if (tempPath) { svg.removeChild(tempPath); tempPath = null; }
    }

    function makePath(dashed) {
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', dashed ? '#888' : '#aaa');
        path.setAttribute('stroke-width', '1.5');
        if (dashed) path.setAttribute('stroke-dasharray', '5,4');
        path.setAttribute('marker-end', dashed ? 'url(#arr-temp)' : 'url(#arr)');
        return path;
    }

    function bezierD(x1, y1, side1, x2, y2, side2) {
        var dist = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
        var cp = Math.min(dist / 2, Math.max(20, dist * 0.4));

        var cx1 = x1, cy1 = y1, cx2 = x2, cy2 = y2;
        if (side1 === 'right')  cx1 = x1 + cp;
        if (side1 === 'left')   cx1 = x1 - cp;
        if (side1 === 'bottom') cy1 = y1 + cp;
        if (side1 === 'top')    cy1 = y1 - cp;

        if (side2 === 'left')   cx2 = x2 - cp;
        if (side2 === 'right')  cx2 = x2 + cp;
        if (side2 === 'top')    cy2 = y2 - cp;
        if (side2 === 'bottom') cy2 = y2 + cp;

        return 'M ' + x1 + ',' + y1 + ' C ' + cx1 + ',' + cy1 + ' ' + cx2 + ',' + cy2 + ' ' + x2 + ',' + y2;
    }

    function edgePt(el, side) {
        var r = el.getBoundingClientRect();
        if (el.classList && el.classList.contains('d')) {
            var sc = r.height / 320;
            if (side === 'top')    return [r.left + r.width / 2, r.top + 85  * sc];
            if (side === 'bottom') return [r.left + r.width / 2, r.top + 216 * sc];
            if (side === 'left')   return [r.left,  r.top + 150 * sc];
            if (side === 'right')  return [r.right, r.top + 150 * sc];
        }
        if (side === 'top')    return [r.left + r.width / 2,  r.top];
        if (side === 'bottom') return [r.left + r.width / 2,  r.bottom];
        if (side === 'left')   return [r.left,                r.top + r.height / 2];
        if (side === 'right')  return [r.right,               r.top + r.height / 2];
    }

    function tick() {
        var sw = 1.5 * (window._chartScale || 1);
        connections.forEach(function (c) {
            var p1 = edgePt(c.from, c.fromSide);
            var p2 = edgePt(c.to, c.toSide);
            c.path.setAttribute('d', bezierD(p1[0], p1[1], c.fromSide, p2[0], p2[1], c.toSide));
            c.path.setAttribute('stroke-width', sw);
        });
        if (pendingFrom && tempPath) {
            var p1 = edgePt(pendingFrom.el, pendingFrom.side);
            tempPath.setAttribute('d', bezierD(p1[0], p1[1], pendingFrom.side, mouseX, mouseY, null));
            tempPath.setAttribute('stroke-width', sw);
        }
        requestAnimationFrame(tick);
    }

    window._addConnNode = addDots;
    window._getConnections = function () { return connections.slice(); };

    window._removeConnsFor = function (el) {
        connections = connections.filter(function (c) {
            if (c.from === el || c.to === el) {
                if (c.path.parentNode) svg.removeChild(c.path);
                return false;
            }
            return true;
        });
    };
})();
