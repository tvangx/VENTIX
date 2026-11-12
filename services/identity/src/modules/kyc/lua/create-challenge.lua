if redis.call('EXISTS', KEYS[1]) == 1 then
  if redis.call('HGET', KEYS[1], 'request_key') == ARGV[1] then
    if redis.call('HGET', KEYS[1], 'fingerprint') ~= ARGV[2] then return {'CONFLICT'} end
    return {'DUPLICATE', redis.call('HGET', KEYS[1], 'challenge_id')}
  end
end
if redis.call('EXISTS', KEYS[2]) == 1 then return {'RATE_LIMITED'} end
redis.call('HSET', KEYS[1], 'request_key', ARGV[1], 'fingerprint', ARGV[2],
  'challenge_id', ARGV[3], 'code_hash', ARGV[4], 'payload', ARGV[5], 'attempts', '0')
redis.call('EXPIRE', KEYS[1], ARGV[6])
redis.call('SET', KEYS[2], '1', 'EX', ARGV[7])
return {'CREATED', ARGV[3]}
