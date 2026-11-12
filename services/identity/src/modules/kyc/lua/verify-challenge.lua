if redis.call('EXISTS', KEYS[1]) == 0 then return {'EXPIRED'} end
if redis.call('HGET', KEYS[1], 'challenge_id') ~= ARGV[1] then return {'EXPIRED'} end
if redis.call('HGET', KEYS[1], 'delivery') ~= 'SENT' then return {'PENDING'} end
local attempts = tonumber(redis.call('HGET', KEYS[1], 'attempts'))
if attempts >= tonumber(ARGV[3]) then return {'LOCKED'} end
if redis.call('HGET', KEYS[1], 'code_hash') ~= ARGV[2] then
  redis.call('HINCRBY', KEYS[1], 'attempts', 1)
  return {'INVALID'}
end
return {'VERIFIED', redis.call('HGET', KEYS[1], 'payload')}
