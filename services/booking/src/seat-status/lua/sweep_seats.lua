-- Chỉ dọn index và thông báo; Redis TTL chịu trách nhiệm xóa seat key.
local time = redis.call('TIME')
local now = time[1] * 1000 + math.floor(time[2] / 1000)
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now, 'LIMIT', 0, 500)
local values = {}
local ttls = {}
-- Đọc trước mọi ghi: lỗi kiểu key không gây cleanup/publish dở dang.
for i, id in ipairs(ids) do
  values[i] = redis.call('GET', ARGV[1] .. id)
  ttls[i] = redis.call('PTTL', ARGV[1] .. id)
end
local expired = 0
for i, id in ipairs(ids) do
  if not values[i] then
    if redis.call('ZREM', KEYS[1], id) == 1 then
      redis.call('PUBLISH', ARGV[2], 'A:' .. id)
      expired = expired + 1
    end
  elseif ttls[i] > 0 then
    -- Index có thể sớm hơn TTL do clock skew hoặc rehydrate/gia hạn.
    redis.call('ZADD', KEYS[1], now + ttls[i], id)
  else
    -- SOLD không có TTL, tuyệt đối không thông báo available.
    redis.call('ZREM', KEYS[1], id)
  end
end
return {#ids, expired}
