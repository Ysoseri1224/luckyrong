INSERT INTO users (id, email, password_hash, display_name, time_zone) VALUES
  ('user-a', 'zwei974@aucklanduni.ac.nz', '7324f4d51eeb378e328750773cd1fbfbfc0410f6892d989f851fd40cec693a85', '小轩', 'Pacific/Auckland'),
  ('user-b', 'yurong7hi@gmail.com', '7324f4d51eeb378e328750773cd1fbfbfc0410f6892d989f851fd40cec693a85', '小荣', 'Asia/Shanghai');

INSERT INTO profiles (id, my_name, partner_name, my_time_zone, partner_time_zone, relationship_start, pair_code, version, updated_at) VALUES
  ('shared', '小轩', '小荣', 'Pacific/Auckland', 'Asia/Shanghai', '2025-01-25', 'together', 1, '2026-07-25T00:00:00.000Z');
