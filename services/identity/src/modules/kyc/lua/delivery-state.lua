if redis.call('HGET', KEYS[1], 'challenge_id') ~= ARGV[1] then return 0 end
if ARGV[2] == 'INVALIDATE' then return redis.call('DEL', KEYS[1]) end
redis.call('HSET', KEYS[1], 'delivery', 'SENT')
return 1
