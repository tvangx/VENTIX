-- Nếu không chỉ định seat key, nhả toàn bộ hold trong cùng thao tác atomic.
local holder = ARGV[1]
local slot = string.match(KEYS[1], '^hold:(%b{}):')
local expiryKey = 'hexp:' .. slot
local channel = 'delta:' .. slot
local kind = redis.call('TYPE', expiryKey).ok
if kind ~= 'none' and kind ~= 'zset' then error('Invalid seat hold metadata type') end
local ids = {}
if #KEYS == 1 then
  ids = redis.call('SMEMBERS', KEYS[1])
else
  -- Kiểm tra kiểu hold set trước khi DEL bất kỳ ghế nào.
  redis.call('SCARD', KEYS[1])
  for i = 2, #ARGV do ids[#ids + 1] = ARGV[i] end
end
-- Đọc toàn bộ trước khi ghi để lỗi kiểu seat key không làm nhả dở dang.
local owned = {}
for _, id in ipairs(ids) do
  if redis.call('GET', 'seat:' .. slot .. ':' .. id) == holder then owned[#owned + 1] = id end
end
for _, id in ipairs(owned) do
  redis.call('DEL', 'seat:' .. slot .. ':' .. id)
  redis.call('SREM', KEYS[1], id)
  redis.call('ZREM', expiryKey, id)
  redis.call('PUBLISH', channel, 'A:' .. id)
end
return #owned
