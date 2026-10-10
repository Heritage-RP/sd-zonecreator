-- client.lua with FiveM stubs (PRODUCTION-SERVER#319, sd-zonecreator#3): the `cancelEdit` export closes the edit
-- session opened by hrp-zones (creator, viewer, NUI focus, nil answer), and onResourceStop puts the player back
-- (ground Z lookup: hidden, frozen, without collision, teleported to z = 1000; viewer camera). Run from the resource
-- folder:
--   docker run --rm -v "$PWD":/w -w /w nickblah/lua:5.4 lua tests/lua/client_spec.lua

local failures = 0
local function check(name, cond)
    if cond then io.write('ok   ', name, '\n') else failures = failures + 1; io.write('FAIL ', name, '\n') end
end

local vec = {}
vec.__index = vec
local function vector3(x, y, z) return setmetatable({ x = x, y = y, z = z }, vec) end
vec.__add = function(a, b) return vector3(a.x + b.x, a.y + b.y, a.z + b.z) end
vec.__sub = function(a, b) return vector3(a.x - b.x, a.y - b.y, a.z - b.z) end
vec.__mul = function(a, b)
    if type(a) == 'number' then a, b = b, a end
    return vector3(a.x * b, a.y * b, a.z * b)
end

local RESOURCE = 'sd-zonecreator'
local PED = 42
local HOME = { x = 100.0, y = -200.0, z = 30.0 }

--- Loads client.lua in a fresh fake client. `ped` describes the local ped before anything happens.
local function load(ped)
    local env = {
        now = 0,
        threads = {},
        nui = {},
        exports = {},
        handlers = {},
        events = {},      -- TriggerEvent calls
        messages = {},    -- SendNUIMessage actions
        focus = {},       -- SetNuiFocus calls
        cams = { rendered = false, destroyed = 0 },
        ped = {
            coords = vector3(HOME.x, HOME.y, HOME.z),
            heading = 90.0,
            visible = not (ped and ped.visible == false),
            collision = true,
            frozen = false,
        },
    }

    -- threads: Wait yields, env.tick(ms) advances a fake clock one millisecond at a time
    _G.CreateThread = function(fn)
        env.threads[#env.threads + 1] = { co = coroutine.create(fn), wake = env.now }
    end
    _G.Citizen = { CreateThread = _G.CreateThread }
    _G.Wait = function(ms) coroutine.yield(ms) end
    _G.SetTimeout = function(ms, fn) _G.CreateThread(function() Wait(ms); fn() end) end
    env.tick = function(ms)
        for _ = 1, ms do
            env.now = env.now + 1
            for _, thread in ipairs(env.threads) do
                if coroutine.status(thread.co) == 'suspended' and thread.wake <= env.now then
                    local ok, waitMs = coroutine.resume(thread.co)
                    if not ok then error(waitMs) end
                    thread.wake = env.now + math.max(tonumber(waitMs) or 0, 1)
                end
            end
        end
    end
    -- a stopped resource's threads die with it
    env.killThreads = function() env.threads = {} end

    _G.vector3, _G.vec3 = vector3, vector3
    _G.LoadResourceFile = function() return '<html></html>' end
    _G.GetCurrentResourceName = function() return RESOURCE end
    _G.lib = {
        print = { error = function() end, info = function() end },
        notify = function() end,
        zones = { poly = function() return { remove = function() end } end },
    }
    _G.RegisterNUICallback = function(name, fn) env.nui[name] = fn end
    _G.exports = setmetatable({}, { __call = function(_, name, fn) env.exports[name] = fn end })
    _G.AddEventHandler = function(name, fn) env.handlers[name] = fn end
    _G.RegisterNetEvent = function(name, fn) env.handlers[name] = fn end
    _G.TriggerEvent = function(name, ...) env.events[#env.events + 1] = { name = name, args = table.pack(...) } end
    _G.SetNuiFocus = function(a, b) env.focus[#env.focus + 1] = { a, b } end
    _G.SendNUIMessage = function(msg) env.messages[#env.messages + 1] = msg.action end
    _G.GetGameTimer = function() return env.now end
    _G.GetFrameTime = function() return 0.016 end

    _G.PlayerPedId = function() return PED end
    _G.GetEntityCoords = function() local c = env.ped.coords; return vector3(c.x, c.y, c.z) end
    _G.SetEntityCoords = function(_, x, y, z) env.ped.coords = vector3(x, y, z) end
    _G.GetEntityHeading = function() return env.ped.heading end
    _G.SetEntityHeading = function(_, h) env.ped.heading = h end
    _G.IsEntityVisible = function() return env.ped.visible end
    _G.SetEntityVisible = function(_, v) env.ped.visible = v end
    _G.SetEntityCollision = function(_, c) env.ped.collision = c end
    _G.FreezeEntityPosition = function(_, f) env.ped.frozen = f end
    _G.RequestCollisionAtCoord = function() end
    _G.HasCollisionLoadedAroundEntity = function() return false end
    _G.GetGroundZFor_3dCoord = function() return false, 0.0 end
    _G.StartShapeTestRay = function() return 1 end
    _G.GetShapeTestResult = function() return 2, 0, vector3(0, 0, 0), vector3(0, 0, 0), 0 end

    _G.CreateCam = function() env.cams.rendered = false; return 7 end
    _G.SetCamCoord, _G.SetCamRot, _G.SetCamFov = function() end, function() end, function() end
    _G.RenderScriptCams = function(on) env.cams.rendered = on end
    _G.DestroyCam = function() env.cams.destroyed = env.cams.destroyed + 1 end
    _G.DisableAllControlActions = function() end
    _G.GetDisabledControlNormal = function() return 0.0 end
    _G.IsDisabledControlPressed = function() return false end
    _G.IsDisabledControlJustPressed = function() return false end

    dofile('client.lua')

    env.callNui = function(name, data)
        local answer
        env.nui[name](data, function(value) answer = value end)
        return answer
    end
    env.lastFocus = function() local f = env.focus[#env.focus]; return f and f[1] end
    env.results = function()
        local results = {}
        for _, e in ipairs(env.events) do
            if e.name == 'sd-zonecreator:editSessionResult' then results[#results + 1] = e.args end
        end
        return results
    end
    env.has = function(action)
        for _, a in ipairs(env.messages) do if a == action then return true end end
        return false
    end
    env.atHome = function()
        local c = env.ped.coords
        return c.x == HOME.x and c.y == HOME.y and c.z == HOME.z and env.ped.heading == 90.0
    end
    env.restored = function(visible)
        return env.atHome() and env.ped.visible == visible and env.ped.collision == true and env.ped.frozen == false
    end
    return env
end

--- One scenario: an error (e.g. a missing export) fails it without stopping the others
local function scenario(fn)
    local ok, err = xpcall(fn, debug.traceback)
    if not ok then check('scenario ran without error: ' .. tostring(err):match('[^\n]*'), false) end
end

local SQUARE = { { x = 0, y = 0 }, { x = 10, y = 0 }, { x = 10, y = 10 }, { x = 0, y = 10 } }
local SESSION = { sessionId = 's1', title = 'Zones', editKey = 'z1', zones = {} }

-- 1. cancelEdit: the session opened by hrp-zones is closed from hrp-zones
scenario(function()
    local env = load()
    check('cancelEdit is exported', type(env.exports.cancelEdit) == 'function')
    check('cancelEdit without a session: false', env.exports.cancelEdit and env.exports.cancelEdit('s1') == false)
    check('editZone opens the session', env.exports.editZone(SESSION) == true and env.lastFocus() == true)
    check('cancelEdit of another session: ignored', env.exports.cancelEdit('other') == false
        and env.lastFocus() == true and #env.results() == 0 and not env.has('hideZoneCreator'))
    check('cancelEdit of the current session: closed', env.exports.cancelEdit('s1') == true)
    check('cancelEdit: NUI focus released', env.lastFocus() == false)
    check('cancelEdit: creator hidden', env.has('hideZoneCreator'))
    local results = env.results()
    check('cancelEdit: the session answers nil once', #results == 1 and results[1][1] == 's1' and results[1][2] == nil
        and results[1].n == 2)
    check('cancelEdit twice: second ignored', env.exports.cancelEdit('s1') == false and #env.results() == 1)
end)

scenario(function()
    local env = load()
    env.exports.editZone(SESSION)
    check('viewer opened from the session', env.callNui('viewZone', { points = SQUARE, groundZ = 5.0 }) == 'ok')
    env.tick(5)
    check('viewer: ped hidden, frozen and moved', env.ped.visible == false and env.ped.frozen == true and not env.atHome()
        and env.cams.rendered == true)
    check('cancelEdit during the viewer', env.exports.cancelEdit('s1') == true)
    check('cancelEdit: viewer camera stopped', env.cams.rendered == false and env.cams.destroyed == 1)
    check('cancelEdit: player back where and as he was', env.restored(true))
    check('cancelEdit: focus released last (the viewer gives it back to the creator first)', env.lastFocus() == false)
    check('cancelEdit: one nil answer', #env.results() == 1 and env.results()[1][2] == nil)
end)

-- 2. onResourceStop during a ground Z lookup: never leave the player hidden, frozen, without collision, in the sky
scenario(function()
    local env = load()
    env.callNui('getPointZ', { x = 500, y = 500 })
    env.tick(400)
    check('lookup running: ped hidden, frozen, no collision, at z = 1000', env.ped.visible == false and env.ped.frozen
        and env.ped.collision == false and env.ped.coords.z == 1000.0)
    env.handlers.onResourceStop('ox_lib')
    check('another resource stopping changes nothing', env.ped.visible == false and env.ped.coords.z == 1000.0)
    env.handlers.onResourceStop(RESOURCE)
    env.killThreads()
    check('stop during the lookup: player back where and as he was', env.restored(true))
end)

scenario(function()
    local env = load({ visible = false }) -- invisible before (staff noclip): stays invisible
    env.callNui('getPointZ', { x = 500, y = 500 })
    env.tick(400)
    env.handlers.onResourceStop(RESOURCE)
    check('stop during the lookup: visibility from before the lookup', env.restored(false))
end)

scenario(function()
    local env = load()
    env.callNui('getPointZ', { x = 500, y = 500 })
    env.tick(20000)
    check('lookup finished on its own: player back', env.restored(true))
    env.ped.coords = vector3(1, 2, 3) -- the player walked away since
    env.handlers.onResourceStop(RESOURCE)
    check('stop after a finished lookup: player not teleported back', env.ped.coords.x == 1 and env.ped.coords.z == 3)
end)

-- 3. onResourceStop during the viewer camera
scenario(function()
    local env = load()
    env.handlers['sd-zonecreator:openZoneCreator']()
    env.exports.editZone(SESSION)
    env.callNui('viewZone', { points = SQUARE, groundZ = 5.0 })
    env.tick(5)
    env.handlers.onResourceStop(RESOURCE)
    env.killThreads()
    check('stop during the viewer: camera stopped', env.cams.rendered == false and env.cams.destroyed == 1)
    check('stop during the viewer: player back where and as he was', env.restored(true))
    check('stop during the viewer: NUI focus released last', env.lastFocus() == false)
    check('stop during the viewer: session answered nil', #env.results() == 1 and env.results()[1][2] == nil)
end)

if failures > 0 then
    io.write(failures, ' failure(s)\n')
    os.exit(1)
end
io.write('all passed\n')
