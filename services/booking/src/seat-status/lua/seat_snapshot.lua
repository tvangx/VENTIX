-- Marker cùng kênh đảm bảo client chỉ replay delta xảy ra SAU snapshot này.
local time = redis.call('TIME')
local now = time[1] * 1000 + math.floor(time[2] / 1000)
local sold = redis.call('SMEMBERS', KEYS[1])
local held = redis.call('ZRANGEBYSCORE', KEYS[2], now, '+inf')
if ARGV[1] ~= '' then redis.call('PUBLISH', ARGV[1], 'snapshot:' .. ARGV[2]) end
return {sold, held, tostring(now)}
