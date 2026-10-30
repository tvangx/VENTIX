-- Snapshot atomic: lọc seat đã hết hạn/đổi chủ, lấy hạn sớm nhất của các ghế còn giữ.
local slot = string.match(KEYS[1], '^hold:(%b{}):')
local result = {0}
for _, id in ipairs(redis.call('SMEMBERS', KEYS[1])) do
  local key = 'seat:' .. slot .. ':' .. id
  if redis.call('GET', key) == ARGV[1] then
    local ttl = redis.call('PTTL', key)
    if ttl > 0 then
      result[#result + 1] = id
      if result[1] == 0 or ttl < result[1] then result[1] = ttl end
    end
  end
end
return result
