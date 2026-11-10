-- KEYS: queue, admitted (expiry ms), grant metadata, tick lock, FIFO sequence.
-- ARGV: operation, user, rate, cap, token TTL seconds, queue TTL seconds, batch nonce,
--       phase starts/ends ms. Every key shares the event hash tag.
local expected = {'zset', 'zset', 'hash', 'string', 'string'}
for i = 1, #KEYS do
  local kind = redis.call('TYPE', KEYS[i]).ok
  if kind ~= 'none' and kind ~= expected[i] then
    return redis.error_reply('Invalid queue metadata type')
  end
end
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local op = ARGV[1]
local user = ARGV[2]
local ttl = tonumber(ARGV[5])
local queueTtl = tonumber(ARGV[6])
-- Reject a stale worker/HTTP phase even if the process paused after its DB read.
if now < tonumber(ARGV[8]) or now >= tonumber(ARGV[9]) then return {-2, '', now, 0, 0} end
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now)
for _, member in ipairs(expired) do
  redis.call('ZREM', KEYS[2], member)
  redis.call('HDEL', KEYS[3], member)
end
if op == 'admit' then
  -- The lock lives until the next Redis second. No separate unlock/pop operation:
  -- a paused/dead replica cannot resume a write after losing its lease.
  local locked = redis.call('SET', KEYS[4], ARGV[7], 'NX', 'PX', 1000 - now % 1000)
  if not locked then return {0, '', now, redis.call('ZCARD', KEYS[1]), redis.call('ZCARD', KEYS[2])} end
  local count = math.max(0, math.min(tonumber(ARGV[3]), tonumber(ARGV[4]) - redis.call('ZCARD', KEYS[2])))
  local users = {}
  if count > 0 then users = redis.call('ZRANGE', KEYS[1], 0, count - 1) end
  local iat = math.floor(now / 1000)
  local exp = iat + ttl
  for _, member in ipairs(users) do
    local grant = cjson.encode({jti = ARGV[7] .. ':' .. member, iat = iat, exp = exp})
    redis.call('HSET', KEYS[3], member, grant)
    redis.call('ZADD', KEYS[2], exp * 1000, member)
    redis.call('ZREM', KEYS[1], member)
  end
  if #users > 0 then
    redis.call('PEXPIRE', KEYS[2], exp * 1000 - now)
    redis.call('PEXPIRE', KEYS[3], exp * 1000 - now)
  end
  return {#users, '', now, redis.call('ZCARD', KEYS[1]), redis.call('ZCARD', KEYS[2])}
end
local grant = redis.call('HGET', KEYS[3], user)
if redis.call('ZSCORE', KEYS[2], user) and grant then
  return {-1, grant, now, redis.call('ZCARD', KEYS[1]), redis.call('ZCARD', KEYS[2])}
end
if op == 'join' then
  if not redis.call('ZSCORE', KEYS[1], user) then
    -- A sequence avoids UUID lexical ordering on equal millisecond join scores.
    local sequence = redis.call('INCR', KEYS[5])
    redis.call('ZADD', KEYS[1], 'NX', sequence, user)
  end
  redis.call('EXPIRE', KEYS[1], queueTtl)
  redis.call('EXPIRE', KEYS[5], queueTtl)
end
local rank = redis.call('ZRANK', KEYS[1], user)
return {rank or -1, '', now, redis.call('ZCARD', KEYS[1]), redis.call('ZCARD', KEYS[2])}
