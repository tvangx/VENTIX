-- KEYS: hold, sold, hexp, delta, seats... (cùng hash tag).
-- ARGV: SELL/RELEASE, holder, expiresAtMs, seatIds...
local function checkType(key, expected)
  local actual = redis.call('TYPE', key).ok
  if actual ~= 'none' and actual ~= expected then error('Invalid saga seat metadata type') end
end
checkType(KEYS[1], 'set')
checkType(KEYS[2], 'set')
checkType(KEYS[3], 'zset')
local slot = string.match(KEYS[1], '^hold:(%b{}):')
local previous = {}
local markers = {}
local foreignHolds = {}
for i = 5, #KEYS do
  checkType(KEYS[i], 'string')
  local id = ARGV[i-1]
  local marker = 'checkout:' .. slot .. ':' .. id
  checkType(marker, 'string')
  previous[i] = redis.call('GET', KEYS[i])
  markers[i] = redis.call('GET', marker)
  if ARGV[1] == 'SELL' and previous[i] and string.sub(previous[i], 1, 2) == 'H:' then
    local hold = 'hold:' .. slot .. ':' .. string.sub(previous[i], 3)
    checkType(hold, 'set')
    foreignHolds[i] = hold
  end
end
local changed = 0
for i = 5, #KEYS do
  local id = ARGV[i-1]
  local marker = 'checkout:' .. slot .. ':' .. id
  if ARGV[1] == 'SELL' then
    -- SOLD trong PostgreSQL đã commit: sửa cả hold khác do TTL/cache bị mất.
    redis.call('SET', KEYS[i], 'S')
    redis.call('SADD', KEYS[2], id)
    redis.call('SREM', KEYS[1], id)
    if foreignHolds[i] then redis.call('SREM', foreignHolds[i], id) end
    redis.call('DEL', marker)
    redis.call('ZREM', KEYS[3], id)
    if previous[i] ~= 'S' then redis.call('PUBLISH', KEYS[4], 'S:' .. id) end
    changed = changed + 1
  elseif ARGV[1] == 'RELEASE' then
    -- Fence theo deadline checkout: retry cũ không được nhả hold/order mới cùng user.
    if previous[i] == ARGV[2] and markers[i] == ARGV[2] .. ':' .. ARGV[3] then
      redis.call('DEL', KEYS[i], marker)
      redis.call('SREM', KEYS[1], id)
      redis.call('ZREM', KEYS[3], id)
      redis.call('PUBLISH', KEYS[4], 'A:' .. id)
      changed = changed + 1
    elseif not previous[i] then
      redis.call('SREM', KEYS[1], id)
      if redis.call('ZREM', KEYS[3], id) == 1 then redis.call('PUBLISH', KEYS[4], 'A:' .. id) end
    end
  else error('Invalid saga seat operation') end
end
return changed
