-- Kiểm tra trước mọi ghi; TTL gia hạn tối đa một lần cho từng hold ghế.
-- KEYS: hold set, seat keys; ARGV: holder, deadlineMs, seatIds...
local slot = string.match(KEYS[1], '^hold:(%b{}):')
local expiryKey = 'hexp:' .. slot
local kind = redis.call('TYPE', expiryKey).ok
if kind ~= 'none' and kind ~= 'zset' then error('Invalid expiry metadata') end
redis.call('SCARD', KEYS[1])
local deadline = tonumber(ARGV[2])
for i=2,#KEYS do
  local id = ARGV[i+1]
  if redis.call('GET', KEYS[i]) ~= ARGV[1] or redis.call('SISMEMBER', KEYS[1], id) ~= 1 then return 0 end
  local prior = redis.call('GET', 'checkout:' .. slot .. ':' .. id)
  if prior then
    local oldHolder, oldDeadline = string.match(prior, '^(H:[^:]+):(%d+)$')
    if oldHolder == ARGV[1] then deadline = math.min(deadline, tonumber(oldDeadline)) end
  end
end
local clock = redis.call('TIME')
local now = tonumber(clock[1])*1000 + math.floor(tonumber(clock[2])/1000)
if deadline <= now then return 0 end
for i=2,#KEYS do
  local id = ARGV[i+1]
  redis.call('SET', 'checkout:' .. slot .. ':' .. id, ARGV[1] .. ':' .. deadline, 'PXAT', deadline)
  redis.call('PEXPIREAT', KEYS[i], deadline)
  redis.call('ZADD', expiryKey, deadline, id)
end
-- Không rút ngắn hold set khi user còn ghế ngoài request.
if redis.call('PTTL', KEYS[1]) < deadline-now then redis.call('PEXPIREAT', KEYS[1], deadline) end
return deadline
