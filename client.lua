if not LoadResourceFile(GetCurrentResourceName(), 'web/build/index.html') then
    print('^1[sd-zonecreator] ERROR: web/build folder not found!^0')
    print('^1[sd-zonecreator] You likely downloaded the source code instead of the release.^0')
    print('^1[sd-zonecreator] Please download the latest release from: https://github.com/Samuels-Development/sd-zonecreator/releases/latest^0')
    return
end

local isZoneCreatorOpen = false -- Whether the zone creator UI is currently open
local isViewingZone = false -- Whether the zone viewer camera is active
local viewerCamera = nil -- Handle for the viewer camera
local originalPlayerCoords = nil -- Player's original coordinates before entering viewer
local originalPlayerHeading = nil -- Player's original heading before entering viewer
local currentDebugZone = nil -- Reference to the current debug zone polygon
local viewerCamCoords = vector3(0, 0, 0) -- Current position of the viewer camera
local viewerCamRot = vector3(0, 0, 0) -- Current rotation of the viewer camera
local currentZoneData = { points = {}, thickness = 150, zoneName = 'preview', groundZ = 0 } -- Current zone data for thickness adjustment
local StopZoneViewer -- Forward declaration of StopZoneViewer function
local zLookupQueue = {} -- Queue of pending Z coordinate lookup requests
local zLookupThreadRunning = false -- Whether the Z lookup background thread is running
local MAX_QUEUE_SIZE = 20 -- Maximum number of queued Z lookups
local Z_CACHE_GRID_SIZE = 10.0 -- Grid size for Z coordinate caching in game units
local zCoordCache = {} -- Cache storing Z coordinates by grid position
local Z_CACHE_TTL = 120000 -- Time-to-live for cached Z values in milliseconds
local Z_LOOKUP_COOLDOWN = 200 -- Minimum time between Z lookups in milliseconds

--- Opens the Zone Creator UI
local function OpenZoneCreator()
    if isZoneCreatorOpen then return end

    isZoneCreatorOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({
        action = 'showZoneCreator'
    })
end

--- Closes the Zone Creator UI
-- Héritage RP: edit session opened by another resource through the `editZone` export (nil when none)
local editSession = nil

--- Ends the current edit session and answers the resource that opened it
---@param zone table|nil Edited zone ({ points = {{x, y}...}, thickness, groundZ }) or nil when cancelled
local function FinishEditSession(zone)
    local session = editSession
    if not session then return end
    editSession = nil
    TriggerEvent('sd-zonecreator:editSessionResult', session.id, zone)
end

local function CloseZoneCreator()
    isZoneCreatorOpen = false
    SetNuiFocus(false, false)
    SendNUIMessage({
        action = 'hideZoneCreator'
    })
    -- Closing the creator during an edit session cancels it.
    FinishEditSession(nil)
end

--- NUI Callback for closing the zone creator
RegisterNUICallback('closeZoneCreator', function(_, cb)
    CloseZoneCreator()
    cb('ok')
end)

--- NUI Callback for copying text to clipboard from zone creator
RegisterNUICallback('copyToClipboard', function(data, cb)
    if data.text then
        SendNUIMessage({
            action = 'copyToClipboard',
            data = { text = data.text }
        })
        lib.notify({
            title = 'Zone Creator',
            description = 'Copied to clipboard!',
            type = 'success'
        })
    end
    cb('ok')
end)

--- Calculates the center point of a polygon
---@param points table Array of {x, y} points
---@return number, number Center X and Y coordinates
local function CalculatePolygonCenter(points)
    local sumX, sumY = 0, 0
    for _, point in ipairs(points) do
        sumX = sumX + point.x
        sumY = sumY + point.y
    end
    return sumX / #points, sumY / #points
end

--- Gets a cache key for coordinates by rounding to grid
---@param x number X coordinate
---@param y number Y coordinate
---@return string Cache key
local function GetZCacheKey(x, y)
    local gridX = math.floor(x / Z_CACHE_GRID_SIZE)
    local gridY = math.floor(y / Z_CACHE_GRID_SIZE)
    return gridX .. "_" .. gridY
end

--- Checks the Z cache for a coordinate
---@param x number X coordinate
---@param y number Y coordinate
---@return number|nil Cached Z value or nil if not found or expired
local function GetCachedZ(x, y)
    local key = GetZCacheKey(x, y)
    local cached = zCoordCache[key]
    if cached then
        local now = GetGameTimer()
        if now - cached.timestamp < Z_CACHE_TTL then
            return cached.z
        else
            zCoordCache[key] = nil
        end
    end
    return nil
end

--- Stores a Z value in the cache
---@param x number X coordinate
---@param y number Y coordinate
---@param z number Z coordinate to cache
local function CacheZ(x, y, z)
    if z then
        local key = GetZCacheKey(x, y)
        zCoordCache[key] = { z = z, timestamp = GetGameTimer() }
    end
end

--- Performs a comprehensive ground Z lookup by teleporting the player
---@param x number X coordinate
---@param y number Y coordinate
---@return number|nil Ground Z coordinate or nil if not found
local function GetGroundZComprehensive(x, y)
    local ped = PlayerPedId()
    local wasVisible = IsEntityVisible(ped)
    local originalCoords = GetEntityCoords(ped)
    local originalHeading = GetEntityHeading(ped)
    local foundZ = nil

    SetEntityVisible(ped, false, false)
    FreezeEntityPosition(ped, true)
    SetEntityCollision(ped, false, false)
    Wait(50)

    SetEntityCoords(ped, x, y, 1000.0, false, false, false, false)
    Wait(100)

    RequestCollisionAtCoord(x, y, 0.0)
    RequestCollisionAtCoord(x, y, 100.0)
    RequestCollisionAtCoord(x, y, 500.0)

    local timeout = 0
    while not HasCollisionLoadedAroundEntity(ped) and timeout < 50 do
        Wait(100)
        timeout = timeout + 1
    end
    Wait(500)

    local searchHeights = { 1000.0, 800.0, 600.0, 400.0, 300.0, 200.0, 150.0, 100.0, 75.0, 50.0, 25.0, 0.0, -50.0 }

    for _, height in ipairs(searchHeights) do
        local found, groundZ = GetGroundZFor_3dCoord(x, y, height, false)
        if found and groundZ ~= 0.0 then
            foundZ = groundZ
            break
        end
        Wait(50)
    end

    if not foundZ then
        local teleportHeights = { 500.0, 200.0, 50.0 }
        for _, tpHeight in ipairs(teleportHeights) do
            SetEntityCoords(ped, x, y, tpHeight, false, false, false, false)
            RequestCollisionAtCoord(x, y, tpHeight)
            Wait(300)

            for _, searchHeight in ipairs(searchHeights) do
                local found, groundZ = GetGroundZFor_3dCoord(x, y, searchHeight, false)
                if found and groundZ ~= 0.0 then
                    foundZ = groundZ
                    break
                end
                Wait(25)
            end

            if foundZ then break end
        end
    end

    if not foundZ then
        SetEntityCoords(ped, x, y, 1000.0, false, false, false, false)
        Wait(200)

        local rayHandle = StartShapeTestRay(x, y, 1000.0, x, y, -100.0, 1, ped, 7)
        local retval, hit, endCoords, surfaceNormal, entityHit
        local rayTimeout = 0
        repeat
            Wait(0)
            retval, hit, endCoords, surfaceNormal, entityHit = GetShapeTestResult(rayHandle)
            rayTimeout = rayTimeout + 1
        until retval ~= 1 or rayTimeout > 100

        if hit == 1 and endCoords.z ~= 0.0 then
            foundZ = endCoords.z
        end
    end

    Wait(100)
    SetEntityCoords(ped, originalCoords.x, originalCoords.y, originalCoords.z, false, false, false, false)
    SetEntityHeading(ped, originalHeading)
    SetEntityCollision(ped, true, true)
    FreezeEntityPosition(ped, false)
    SetEntityVisible(ped, wasVisible, false)

    return foundZ
end

--- Background thread that processes the Z lookup queue
local function StartZLookupThread()
    if zLookupThreadRunning then return end
    zLookupThreadRunning = true

    CreateThread(function()
        Wait(100)

        while #zLookupQueue > 0 do
            local request = table.remove(zLookupQueue, 1)
            local x, y, callback = request.x, request.y, request.callback

            local cachedZ = GetCachedZ(x, y)
            if cachedZ then
                callback(cachedZ, x, y)
                Wait(50)
            else
                local foundZ = GetGroundZComprehensive(x, y)

                if foundZ then
                    CacheZ(x, y, foundZ)
                end

                callback(foundZ, x, y)
                Wait(100)
            end
        end

        zLookupThreadRunning = false
    end)
end

--- Queues an asynchronous Z coordinate lookup
---@param x number X coordinate
---@param y number Y coordinate
---@param callback function Callback function receiving (groundZ, actualX, actualY)
local function GetGroundZAtPositionAsync(x, y, callback)
    local cachedZ = GetCachedZ(x, y)
    if cachedZ then
        SetTimeout(0, function()
            callback(cachedZ, x, y)
        end)
        return
    end

    if #zLookupQueue >= MAX_QUEUE_SIZE then
        SetTimeout(0, function()
            callback(nil, x, y)
        end)
        return
    end

    local cacheKey = GetZCacheKey(x, y)
    for _, request in ipairs(zLookupQueue) do
        if GetZCacheKey(request.x, request.y) == cacheKey then
            SetTimeout(0, function()
                callback(nil, x, y)
            end)
            return
        end
    end

    table.insert(zLookupQueue, { x = x, y = y, callback = callback })
    StartZLookupThread()
end

--- Gets ground Z at position synchronously for use in zone viewer
---@param x number X coordinate
---@param y number Y coordinate
---@return number Z coordinate or default fallback value
local function GetGroundZAtPosition(x, y)
    local searchHeights = { 1000.0, 500.0, 200.0, 100.0, 50.0, 0.0 }
    for _, height in ipairs(searchHeights) do
        local found, groundZ = GetGroundZFor_3dCoord(x, y, height, false)
        if found and groundZ ~= 0.0 then
            return groundZ
        end
    end
    return 50.0
end

--- Creates a debug zone polygon using ox_lib
---@param points table Array of {x, y} points
---@param thickness number Zone thickness
---@param name string Zone name
---@param groundZ number The ground Z coordinate for the zone base
local function CreateDebugZone(points, thickness, name, groundZ)
    if currentDebugZone then
        currentDebugZone:remove()
        currentDebugZone = nil
    end

    local zonePoints = {}
    for _, point in ipairs(points) do
        table.insert(zonePoints, vec3(point.x, point.y, groundZ))
    end

    currentDebugZone = lib.zones.poly({
        name = 'zonehelper_preview_' .. name,
        points = zonePoints,
        thickness = thickness,
        debug = true,
        debugColour = { 34, 197, 94, 100 }
    })
end

--- Removes the current debug zone if it exists
local function RemoveDebugZone()
    if currentDebugZone then
        currentDebugZone:remove()
        currentDebugZone = nil
    end
end

--- Updates the debug zone with the current zone data thickness
local function UpdateDebugZoneThickness()
    CreateDebugZone(currentZoneData.points, currentZoneData.thickness, currentZoneData.zoneName, currentZoneData.groundZ)
end

--- Stops the zone viewer and returns player to original state
StopZoneViewer = function()
    if not isViewingZone then return end

    isViewingZone = false

    RemoveDebugZone()

    if viewerCamera then
        RenderScriptCams(false, true, 500, true, false)
        DestroyCam(viewerCamera, false)
        viewerCamera = nil
    end

    local ped = PlayerPedId()

    SetEntityVisible(ped, true, false)
    SetEntityCollision(ped, true, true)
    FreezeEntityPosition(ped, false)

    if originalPlayerCoords then
        SetEntityCoords(ped, originalPlayerCoords.x, originalPlayerCoords.y, originalPlayerCoords.z, false, false, false, false)
        SetEntityHeading(ped, originalPlayerHeading or 0.0)
    end

    if isZoneCreatorOpen then
        SetNuiFocus(true, true)
        SendNUIMessage({
            action = 'zoneViewerStopped',
            data = {
                thickness = currentZoneData.thickness
            }
        })
    end
end

--- Starts the zone viewer camera at the specified location
---@param centerX number Center X coordinate of the zone
---@param centerY number Center Y coordinate of the zone
---@param points table Array of zone points
---@param groundZ number Ground Z coordinate
---@param thickness number Zone thickness
---@param zoneName string Name of the zone
local function StartZoneViewer(centerX, centerY, points, groundZ, thickness, zoneName)
    if isViewingZone then return end

    local ped = PlayerPedId()

    local actualGroundZ = groundZ or GetGroundZAtPosition(centerX, centerY)

    currentZoneData.points = points
    currentZoneData.thickness = thickness
    currentZoneData.zoneName = zoneName
    currentZoneData.groundZ = actualGroundZ

    originalPlayerCoords = GetEntityCoords(ped)
    originalPlayerHeading = GetEntityHeading(ped)

    local cameraZ = actualGroundZ + 50.0

    CreateDebugZone(points, thickness, zoneName, actualGroundZ)

    viewerCamera = CreateCam('DEFAULT_SCRIPTED_CAMERA', true)
    viewerCamCoords = vector3(centerX, centerY, cameraZ)
    viewerCamRot = vector3(-45.0, 0.0, 0.0)

    SetCamCoord(viewerCamera, viewerCamCoords.x, viewerCamCoords.y, viewerCamCoords.z)
    SetCamRot(viewerCamera, viewerCamRot.x, viewerCamRot.y, viewerCamRot.z, 2)
    SetCamFov(viewerCamera, 60.0)
    RenderScriptCams(true, true, 500, true, false)

    SetEntityVisible(ped, false, false)
    SetEntityCollision(ped, false, false)
    FreezeEntityPosition(ped, true)

    SetEntityCoords(ped, centerX, centerY, actualGroundZ, false, false, false, false)

    isViewingZone = true

    SetNuiFocus(false, false)

    SendNUIMessage({
        action = 'zoneViewerStarted',
        data = {
            groundZ = actualGroundZ,
            thickness = thickness
        }
    })

    local moveSpeed = 1.0
    local rotSpeed = 3.0
    local heightAdjustCooldown = 0

    CreateThread(function()
        while isViewingZone do
            Wait(0)

            DisableAllControlActions(0)

            local mouseX = GetDisabledControlNormal(0, 1) * rotSpeed
            local mouseY = GetDisabledControlNormal(0, 2) * rotSpeed

            viewerCamRot = vector3(
                math.max(-89.0, math.min(89.0, viewerCamRot.x - mouseY)),
                viewerCamRot.y,
                viewerCamRot.z - mouseX
            )

            local radX = math.rad(viewerCamRot.x)
            local radZ = math.rad(viewerCamRot.z)

            local forward = vector3(
                -math.sin(radZ) * math.cos(radX),
                math.cos(radZ) * math.cos(radX),
                math.sin(radX)
            )

            local right = vector3(
                math.cos(radZ),
                math.sin(radZ),
                0.0
            )

            if IsDisabledControlPressed(0, 15) then
                moveSpeed = math.min(moveSpeed * 1.1, 10.0)
            elseif IsDisabledControlPressed(0, 14) then
                moveSpeed = math.max(moveSpeed * 0.9, 0.1)
            end

            local movement = vector3(0, 0, 0)

            if IsDisabledControlPressed(0, 32) then
                movement = movement + forward
            end
            if IsDisabledControlPressed(0, 33) then
                movement = movement - forward
            end
            if IsDisabledControlPressed(0, 34) then
                movement = movement - right
            end
            if IsDisabledControlPressed(0, 35) then
                movement = movement + right
            end
            if IsDisabledControlPressed(0, 44) then
                movement = movement - vector3(0, 0, 1)
            end
            if IsDisabledControlPressed(0, 38) then
                movement = movement + vector3(0, 0, 1)
            end

            if IsDisabledControlPressed(0, 21) then
                movement = movement * 3.0
            end

            viewerCamCoords = viewerCamCoords + (movement * moveSpeed)

            SetCamCoord(viewerCamera, viewerCamCoords.x, viewerCamCoords.y, viewerCamCoords.z)
            SetCamRot(viewerCamera, viewerCamRot.x, viewerCamRot.y, viewerCamRot.z, 2)

            if heightAdjustCooldown <= 0 then
                local thicknessChanged = false
                if IsDisabledControlPressed(0, 172) then
                    currentZoneData.thickness = currentZoneData.thickness + 1.0
                    UpdateDebugZoneThickness()
                    heightAdjustCooldown = 100
                    thicknessChanged = true
                elseif IsDisabledControlPressed(0, 173) then
                    if currentZoneData.thickness > 1.0 then
                        currentZoneData.thickness = currentZoneData.thickness - 1.0
                        UpdateDebugZoneThickness()
                        thicknessChanged = true
                    end
                    heightAdjustCooldown = 100
                end

                if thicknessChanged then
                    SendNUIMessage({
                        action = 'zoneViewerUpdate',
                        data = {
                            groundZ = currentZoneData.groundZ,
                            thickness = currentZoneData.thickness
                        }
                    })
                end
            else
                heightAdjustCooldown = heightAdjustCooldown - GetFrameTime() * 1000
            end

            if IsDisabledControlJustPressed(0, 177) then
                StopZoneViewer()
            end
        end
    end)
end

--- NUI Callback for getting ground Z at a position
RegisterNUICallback('getPointZ', function(data, cb)
    local x = tonumber(data.x)
    local y = tonumber(data.y)

    if not x or not y then
        cb({ z = nil, x = nil, y = nil })
        return
    end

    GetGroundZAtPositionAsync(x, y, function(groundZ, actualX, actualY)
        cb({
            z = groundZ,
            x = actualX or x,
            y = actualY or y
        })
    end)
end)

--- NUI Callback for viewing a zone in 3D
RegisterNUICallback('viewZone', function(data, cb)
    local points = data.points
    local groundZ = data.groundZ or 0
    local thickness = data.thickness or 150
    local zoneName = data.zoneName or 'preview'

    if not points or #points < 3 then
        lib.notify({
            title = 'Zone Viewer',
            description = 'Need at least 3 points to view zone',
            type = 'error'
        })
        cb('error')
        return
    end

    local centerX, centerY = CalculatePolygonCenter(points)

    StartZoneViewer(centerX, centerY, points, groundZ, thickness, zoneName)

    cb('ok')
end)

--- Event handler for opening the zone creator from server command
--- Héritage RP: opens the creator on zones given by another resource; « Valider » sends the zone `editKey` back.
--- The answer comes as the local client event `sd-zonecreator:editSessionResult` (sessionId, zone|nil).
---@param session table { sessionId = string, title = string, editKey = string, zones = { { key, name, points = {{x, y}...}, thickness, groundZ, color? } } }
---@return boolean opened
exports('editZone', function(session)
    if type(session) ~= 'table' or type(session.sessionId) ~= 'string' or type(session.zones) ~= 'table' then
        return false
    end
    if isViewingZone then StopZoneViewer() end
    FinishEditSession(nil)

    editSession = { id = session.sessionId }
    isZoneCreatorOpen = true
    SetNuiFocus(true, true)
    SendNUIMessage({
        action = 'openEditSession',
        data = session
    })
    return true
end)

--- NUI Callback for « Valider » in an edit session
RegisterNUICallback('editSessionResult', function(data, cb)
    cb('ok')
    if not editSession or type(data) ~= 'table' or data.sessionId ~= editSession.id then return end
    local zone = data.zone
    isZoneCreatorOpen = false
    SetNuiFocus(false, false)
    SendNUIMessage({
        action = 'hideZoneCreator'
    })
    FinishEditSession(zone)
end)

AddEventHandler('onResourceStop', function(resourceName)
    if resourceName ~= GetCurrentResourceName() then return end
    if isZoneCreatorOpen then SetNuiFocus(false, false) end
    FinishEditSession(nil)
end)

RegisterNetEvent('sd-zonecreator:openZoneCreator', function()
    OpenZoneCreator()
end)

--- Background thread that sends player position updates to the NUI
CreateThread(function()
    while true do
        Wait(500)
        if isZoneCreatorOpen then
            local ped = PlayerPedId()
            local coords = GetEntityCoords(ped)
            SendNUIMessage({
                action = 'updatePlayerPosition',
                data = {
                    x = coords.x,
                    y = coords.y,
                    z = coords.z
                }
            })
        end
    end
end)
