-- KEYS[1] = hold set, KEYS[2..] = seat keys.
-- ARGV = holderTag, ttlSec, maxSeats, nowMs, seatIds...
-- holdlogEnabled được adapter khai báo bằng boolean trước khi nạp script.
local holder = ARGV[1]
local ttl = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local slot = string.match(KEYS[1], '^hold:(%b{}):')
local expiryKey = 'hexp:' .. slot
local channel = 'delta:' .. slot
local logKey = 'holdlog:' .. slot

-- Lua không rollback lỗi runtime: kiểm tra kiểu metadata trước mọi thao tác ghi.
local function checkType(key, expected)
  local actual = redis.call('TYPE', key).ok
  if actual ~= 'none' and actual ~= expected then
    error('Invalid seat hold metadata type')
  end
end
checkType(KEYS[1], 'set')
checkType(expiryKey, 'zset')
if holdlogEnabled then checkType(logKey, 'stream') end

local added = 0
for i = 2, #KEYS do
  local value = redis.call('GET', KEYS[i])
  if value and value ~= holder then return {0, KEYS[i]} end
  if redis.call('SISMEMBER', KEYS[1], ARGV[i + 3]) == 0 then added = added + 1 end
end

-- Gia hạn một phần giữ set lâu hơn một số seat key. Chỉ đếm thành viên còn thuộc chủ.
local stale = {}
local live = redis.call('SCARD', KEYS[1])
for _, id in ipairs(redis.call('SMEMBERS', KEYS[1])) do
  if redis.call('GET', 'seat:' .. slot .. ':' .. id) ~= holder then
    live = live - 1
    stale[#stale + 1] = id
    -- Seat hết hạn được giữ lại trong request này vẫn là ghế mới.
    for i = 5, #ARGV do
      if ARGV[i] == id then added = added + 1 end
    end
  end
end
if live + added > limit then return {2} end

for _, id in ipairs(stale) do redis.call('SREM', KEYS[1], id) end
for i = 2, #KEYS do
  local id = ARGV[i + 3]
  redis.call('SET', KEYS[i], holder, 'EX', ttl)
  redis.call('SADD', KEYS[1], id)
  redis.call('ZADD', expiryKey, now + ttl * 1000, id)
end
redis.call('EXPIRE', KEYS[1], ttl)
for i = 5, #ARGV do redis.call('PUBLISH', channel, 'H:' .. ARGV[i]) end
if holdlogEnabled then
  redis.call('XADD', logKey, '*', 'holder', holder, 'seat_ids', cjson.encode({unpack(ARGV, 5)}), 'expires_at', now + ttl * 1000)
end
return {1}
