window.addEventListener('DOMContentLoaded', function () {
    var mainUL = document.querySelector('#main');
    var values = JSON.parse(sessionStorage.getItem('src'));
    if (!values) return;

    var NODE_W = 220, H_GAP = 100, ROW_H = 320, TOP_BUFFER = 200;
    var curX = {}, laneY = {}, diamondX = {}, diamondType = {};
    var autoConns = [], lastNodeId = {}, lastDiamondId = {};
    var maxPlacedY = 0;
    var sectionBaseY = 0;
    var pendingBranch = null;
    var pendingExits = [];        // explicit endif/endelse exits → drain on any node
    var pendingExitsStack = [];   // stack for saving pendingExits across else-branches
    var pendingNoPathExits = [];  // implicit-endif diamond "no" exits → drain on very next node
    var diamondHadElse = {};      // diamondId -> true when an else was seen for it

    function gx(L) { return curX[L] || 0; }
    function gy(L) { return (laneY[L] !== undefined ? laneY[L] : L * ROW_H + sectionBaseY) + TOP_BUFFER; }
    function advance(L) { curX[L] = gx(L) + NODE_W + H_GAP; }

    function connectToPrev(L, id) {
        // Diamond "no" chain exits: drain onto the very next node (connects chained ifs)
        pendingNoPathExits.forEach(function (ex) {
            autoConns.push({ fromId: ex.fromId, fromSide: ex.fromSide, toId: id, toSide: 'left' });
        });
        pendingNoPathExits = [];

        pendingExits.forEach(function (ex) {
            autoConns.push({ fromId: ex.fromId, fromSide: ex.fromSide, toId: id, toSide: 'left' });
        });
        pendingExits = [];

        if (pendingBranch) {
            autoConns.push({ fromId: pendingBranch.fromId, fromSide: pendingBranch.fromSide, toId: id, toSide: pendingBranch.toSide });
            pendingBranch = null;
        } else if (lastNodeId[L] !== undefined) {
            autoConns.push({ fromId: lastNodeId[L], fromSide: 'right', toId: id, toSide: 'left' });
        }
        lastNodeId[L] = id;
    }

    var tokens = values.filter(function (v) { return v && v.replace(/\s/g, ''); });

    var laneOf = [], lane = 0;
    for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (t === 'endthen' || t === 'endelse') lane = Math.max(0, lane - 1);
        if (t === 'then'    || t === 'else')    lane++;
        laneOf.push(lane);
    }

    for (var i = 0; i < tokens.length; i++) {
        if (!tokens[i]) continue;
        var tok = tokens[i], L = laneOf[i];

        switch (tok) {
            case 'if': {
                var label = tokens[i + 1] || '';
                tokens[i + 1] = null;
                var px = gx(L);
                mkDiamond(L, px, label.trim(), i);
                advance(L);
                curX[L + 1] = gx(L);
                if (laneY[L + 1] === undefined) laneY[L + 1] = gy(L) - TOP_BUFFER;
                diamondX[i] = px;
                diamondType[i] = 'if';
                break;
            }
            case 'if2': {
                var label = tokens[i + 1] || '';
                tokens[i + 1] = null;
                var px = gx(L);
                mkDiamond(L, px, label.trim(), i, 'if2');
                advance(L);
                curX[L + 1] = px;
                delete laneY[L + 1];
                diamondX[i] = px;
                diamondType[i] = 'if2';
                break;
            }
            case 'then': {
                var dId = lastDiamondId[L - 1];
                if (dId !== undefined) {
                    if (diamondType[dId] === 'if2') {
                        pendingBranch = { fromId: dId, fromSide: 'bottom', toSide: 'top' };
                    } else {
                        pendingBranch = { fromId: dId, fromSide: 'right', toSide: 'left' };
                    }
                }
                break;
            }
            case 'else': {
                var dId = lastDiamondId[L - 1];
                if (dId !== undefined) {
                    diamondHadElse[dId] = true;
                    if (diamondType[dId] === 'if2') {
                        pendingBranch = { fromId: dId, fromSide: 'right', toSide: 'left' };
                        laneY[L] = gy(L - 1) - TOP_BUFFER;
                        curX[L] = gx(L - 1);
                    } else {
                        pendingBranch = { fromId: dId, fromSide: 'bottom', toSide: 'top' };
                        delete laneY[L];
                        curX[L] = diamondX[dId] || 0;
                    }
                }
                // Save then-exits so else-branch nodes don't drain them
                pendingExitsStack.push(pendingExits);
                pendingExits = [];
                break;
            }
            case 'endthen': {
                var thenExitId = lastNodeId[L + 1];
                if (thenExitId !== undefined) {
                    lastNodeId[L + 1] = undefined;
                    // Peek at next meaningful token
                    var nextTok = null;
                    for (var j = i + 1; j < tokens.length; j++) {
                        if (tokens[j] && tokens[j].trim()) { nextTok = tokens[j]; break; }
                    }
                    if (nextTok === 'else') {
                        // else follows: then-exit reconnects at post-endif node
                        pendingExits.push({ fromId: thenExitId, fromSide: 'right' });
                        curX[L] = Math.max(gx(L), gx(L + 1) || 0);
                    } else {
                        // No else: yes-branch is a dead end; only diamond "no" path continues
                        var dId2 = lastDiamondId[L];
                        if (dId2 !== undefined) {
                            var noSide = diamondType[dId2] === 'if2' ? 'right' : 'bottom';
                            pendingNoPathExits.push({ fromId: dId2, fromSide: noSide });
                            delete lastDiamondId[L];
                        }
                        lastNodeId[L] = undefined;
                        curX[L] = Math.max(gx(L), gx(L + 1) || 0);
                    }
                }
                pendingBranch = null;
                break;
            }
            case 'endelse':
                if (lastNodeId[L + 1] !== undefined) {
                    pendingExits.push({ fromId: lastNodeId[L + 1], fromSide: 'right' });
                    lastNodeId[L + 1] = undefined;
                }
                // Merge saved then-exits back so both branches connect to post-endif node
                pendingExits = pendingExits.concat(pendingExitsStack.pop() || []);
                pendingBranch = null;
                break;
            case 'endif': {
                var dId = lastDiamondId[L];
                // If no else branch, the diamond's no-path also exits to next node
                if (dId !== undefined && !diamondHadElse[dId]) {
                    var noSide = diamondType[dId] === 'if2' ? 'right' : 'bottom';
                    pendingExits.push({ fromId: dId, fromSide: noSide });
                }
                delete diamondHadElse[dId];
                lastNodeId[L] = undefined;
                pendingBranch = null;
                curX[L] = Math.max(gx(L), gx(L + 1) || 0);
                // When top-level endif leaves no pending connections, start a new flow section
                if (L === 0 && pendingExits.length === 0) {
                    sectionBaseY = maxPlacedY + 220;
                    Object.keys(laneY).forEach(function(k) { delete laneY[k]; });
                    curX[0] = 0;
                }
                break;
            }
            case 'endflow': {
                var efLabel = tokens[i + 1] || '';
                if (efLabel && !['if','if2','else','endif','endthen','endflow','endelse','endprocess','then','none','file','db'].includes(efLabel.trim())) {
                    tokens[i + 1] = null;
                } else {
                    efLabel = '';
                }
                mkEndflow(L, gx(L), i, efLabel.trim());
                advance(L);
                break;
            }
            case 'file': {
                var label = tokens[i + 1] || '';
                tokens[i + 1] = null;
                mkProcFile(L, gx(L), label.trim(), i, false);
                advance(L);
                break;
            }
            case 'db': {
                var label = tokens[i + 1] || '';
                tokens[i + 1] = null;
                var trimmedDb = label.trim();
                var fmDb = trimmedDb.match(/^(.*?)\s+<-\s+file\(([^)]*)\)\s*$/i);
                if (fmDb) {
                    var dbLabel = fmDb[1].trim();
                    var fileLabel = fmDb[2].trim();
                    var colX = gx(L);
                    mkProcDb(L, colX, dbLabel, i);
                    advance(L);
                    var fileId = '__f' + i;
                    mkProcFile(L, colX, fileLabel !== 'none' ? fileLabel : '', fileId, true, gy(L) - 180);
                    autoConns.push({ fromId: fileId, fromSide: 'bottom', toId: i, toSide: 'top' });
                } else {
                    mkProcDb(L, gx(L), trimmedDb, i);
                    advance(L);
                }
                break;
            }
            case 'endprocess':
            case 'none':
                break;
            default:
                if (tok.trim()) {
                    var trimmed = tok.trim();
                    var fm = trimmed.match(/^(.*?)\s+<-\s+file\(([^)]*)\)\s*$/i);
                    if (fm) {
                        var procPart = fm[1].trim();
                        var fileLabel = fm[2].trim();
                        var um2 = procPart.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
                        var pLabel = um2 ? um2[1].trim() : procPart;
                        var pUrl   = (um2 && um2[2] !== 'none') ? um2[2].trim() : '';
                        var colX = gx(L);
                        // Process first so connectToPrev chains prev → process
                        mkProcDoc(L, colX, pLabel, pUrl, i);
                        advance(L);
                        // File placed above process: same column X, shifted up
                        var fileId = '__f' + i;
                        mkProcFile(L, colX, fileLabel !== 'none' ? fileLabel : '', fileId, true, gy(L) - 180);
                        autoConns.push({ fromId: fileId, fromSide: 'bottom', toId: i, toSide: 'top' });
                    } else {
                        var um = trimmed.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
                        var nodeLabel = um ? um[1].trim() : trimmed;
                        var nodeUrl   = (um && um[2] !== 'none') ? um[2].trim() : '';
                        mkProcDoc(L, gx(L), nodeLabel, nodeUrl, i);
                        advance(L);
                    }
                }
        }
    }

    window._autoConns = autoConns;
    mainUL.style.minHeight = (maxPlacedY + 600) + 'px';

    function place(li, L, px) {
        li.style.position = 'absolute';
        li.style.left = px + 'px';
        li.style.top  = gy(L) + 'px';
        mainUL.appendChild(li);
        maxPlacedY = Math.max(maxPlacedY, gy(L));
    }

    function mkProcess(L, px, body, id) {
        var li = document.createElement('li');
        li.id = id;
        li.innerHTML =
            '<p class="process">' + body + '</p>' +
            '<a href="./chart.html">document:none</a>' +
            '<div class="modal none">' +
            '<input type="text" class="filename" placeholder="file name">' +
            '<input type="text" class="url" placeholder="url">' +
            '<br></div>';
        place(li, L, px);
        li.addEventListener('click', makeHandler(id));
        connectToPrev(L, id);
    }

    function mkProcFile(L, px, label, id, skipConn, overrideY) {
        var li = document.createElement('li');
        li.id = id;
        li.innerHTML = '<div class="proc-file"><span class="proc-file-label">' + (label || '') + '</span></div>';
        li.style.position = 'absolute';
        li.style.left = px + 'px';
        li.style.top = (overrideY !== undefined ? overrideY : gy(L)) + 'px';
        mainUL.appendChild(li);
        if (overrideY === undefined) maxPlacedY = Math.max(maxPlacedY, gy(L));
        if (!skipConn) connectToPrev(L, id);
    }

    function mkProcDb(L, px, label, id) {
        var li = document.createElement('li');
        li.id = id;
        li.innerHTML = '<div class="proc-db"><span class="proc-db-label">' + (label || '') + '</span></div>';
        place(li, L, px);
        connectToPrev(L, id);
    }

    function mkProcDoc(L, px, label, url, id) {
        var li = document.createElement('li');
        li.id = id;
        li.innerHTML =
            '<div class="proc-doc">' +
            '<span class="proc-doc-label">' + label + '</span>' +
            '<input type="text" class="proc-doc-url" placeholder="none">' +
            '</div>';
        place(li, L, px);
        var urlInput = li.querySelector('.proc-doc-url');
        if (url) urlInput.value = url;
        urlInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && this.value.trim()) window.open(this.value.trim(), '_blank');
        });
        connectToPrev(L, id);
    }

    function mkDiamond(L, px, body, id, extraClass) {
        var li = document.createElement('li');
        li.id = id;
        li.className = extraClass ? 'd ' + extraClass : 'd';
        li.innerHTML =
            '<div class="diamond"><p class="d-body">' + body + '</p></div>' +
            '<span class="y">yes</span><span class="n">no</span>';
        place(li, L, px);
        connectToPrev(L, id);
        lastDiamondId[L] = id;
    }

    function mkEndflow(L, px, id, label) {
        var li = document.createElement('li');
        li.id = id;
        li.className = 'half ef';
        li.innerHTML = '<div class="endflow"></div><input type="text" class="endflow-label">';
        if (label) li.querySelector('.endflow-label').value = label;
        place(li, L, px);
        connectToPrev(L, id);
        lastNodeId[L] = undefined;
    }

    function makeHandler(id) {
        return function () {
            var modal  = document.querySelector('[id="' + id + '"] .modal');
            var a      = document.querySelector('[id="' + id + '"] a');
            var urlEl  = document.querySelector('[id="' + id + '"] .url');
            var nameEl = document.querySelector('[id="' + id + '"] .filename');
            if (modal)  modal.classList.remove('none');
            if (urlEl  && a) a.href      = urlEl.value;
            if (nameEl && a) a.innerHTML = nameEl.value || 'document:none';
        };
    }

    document.addEventListener('click', function (e) {
        if (!e.target.closest('.process') && !e.target.closest('.url') && !e.target.closest('.filename')) {
            document.querySelectorAll('.modal').forEach(function (m) { m.classList.add('none'); });
        }
    });
});
