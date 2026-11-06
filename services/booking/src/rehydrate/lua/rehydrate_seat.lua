-- KEYS: seat, sold set, user hold set, hold expiry zset (cùng hash tag).
-- ARGV: allocation state, seatId, holder, expiresAtMs (UTC từ PostgreSQL).
local function checkType(key, expected)
  local actual = redis.call('TYPE', key).ok
  if actual ~= 'none' and actual ~= expected then error('Invalid rehydrate metadata type') end
end
checkType(KEYS[1], 'string')
if ARGV[1] == 'SOLD' then
  checkType(KEYS[2], 'set')
  local inserted = redis.call('SET', KEYS[1], 'S', 'NX')
  if inserted or redis.call('GET', KEYS[1]) == 'S' then redis.call('SADD', KEYS[2], ARGV[2]) end
  return inserted and 1 or 0
end
checkType(KEYS[3], 'set')
checkType(KEYS[4], 'zset')
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local expires = tonumber(ARGV[4])
if expires <= now then return 0 end
-- PXAT giữ đúng hạn DB kể cả khi xử lý trang kéo dài.
if not redis.call('SET', KEYS[1], ARGV[3], 'PXAT', expires, 'NX') then return 0 end
redis.call('SADD', KEYS[3], ARGV[2])
if redis.call('PEXPIRETIME', KEYS[3]) < expires then redis.call('PEXPIREAT', KEYS[3], expires) end
redis.call('ZADD', KEYS[4], expires, ARGV[2])
return 1
