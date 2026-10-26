-- =============================================================================
-- FLOWTRACK — Fictional Company Demo Seed Data
-- Organization: Nusantara Supplies Co. (Demo Data)
-- NOTE: All records, metrics, and financial figures below are fictional sample
-- data created for portfolio demonstration purposes only.
-- =============================================================================

begin;

-- 1. Organization settings & illustrative ROI baseline assumptions
update public.app_settings
   set organization_name           = 'Nusantara Supplies Co. (Demo)',
       currency                    = 'IDR',
       allow_self_approval         = false,
       manual_minutes_per_request  = 95,
       digital_minutes_per_request = 18,
       manual_cycle_days           = 5.00,
       hourly_staff_cost           = 85000.00
 where id = 1;

-- 2. Departments
insert into public.departments (id, code, name, is_active) values
  ('00000000-0000-4000-8000-000000000101', 'OPS',  'Operations & Logistics',       true),
  ('00000000-0000-4000-8000-000000000102', 'IT',   'Information Technology',       true),
  ('00000000-0000-4000-8000-000000000103', 'FIN',  'Finance & Accounting',         true),
  ('00000000-0000-4000-8000-000000000104', 'PROC', 'Procurement & Vendor Mgmt',    true),
  ('00000000-0000-4000-8000-000000000105', 'HR',   'People & Workplace Operations', true)
on conflict (id) do update
  set code = excluded.code,
      name = excluded.name,
      is_active = excluded.is_active;

-- 3. Demo Users (auth.users trigger automatically creates public.profiles rows)
insert into auth.users (id, email, raw_user_meta_data, created_at) values
  ('00000000-0000-4000-8000-000000000201', 'rina.wijaya@nusantara-demo.id',   '{"full_name":"Rina Wijaya"}',   now() - interval '150 days'),
  ('00000000-0000-4000-8000-000000000202', 'dimas.pratama@nusantara-demo.id', '{"full_name":"Dimas Pratama"}', now() - interval '145 days'),
  ('00000000-0000-4000-8000-000000000203', 'siti.rahma@nusantara-demo.id',    '{"full_name":"Siti Rahma"}',    now() - interval '140 days'),
  ('00000000-0000-4000-8000-000000000204', 'budi.santoso@nusantara-demo.id',  '{"full_name":"Budi Santoso"}',  now() - interval '160 days'),
  ('00000000-0000-4000-8000-000000000205', 'hendra.kusuma@nusantara-demo.id', '{"full_name":"Hendra Kusuma"}', now() - interval '160 days'),
  ('00000000-0000-4000-8000-000000000206', 'nadia.putri@nusantara-demo.id',   '{"full_name":"Nadia Putri"}',   now() - interval '170 days')
on conflict (id) do nothing;

-- Assign roles and departments
update public.profiles set role = 'employee', department_id = '00000000-0000-4000-8000-000000000101', full_name = 'Rina Wijaya'   where id = '00000000-0000-4000-8000-000000000201';
update public.profiles set role = 'employee', department_id = '00000000-0000-4000-8000-000000000102', full_name = 'Dimas Pratama' where id = '00000000-0000-4000-8000-000000000202';
update public.profiles set role = 'employee', department_id = '00000000-0000-4000-8000-000000000103', full_name = 'Siti Rahma'    where id = '00000000-0000-4000-8000-000000000203';
update public.profiles set role = 'manager',  department_id = '00000000-0000-4000-8000-000000000101', full_name = 'Budi Santoso'  where id = '00000000-0000-4000-8000-000000000204';
update public.profiles set role = 'manager',  department_id = '00000000-0000-4000-8000-000000000102', full_name = 'Hendra Kusuma' where id = '00000000-0000-4000-8000-000000000205';
update public.profiles set role = 'admin',    department_id = '00000000-0000-4000-8000-000000000103', full_name = 'Nadia Putri'   where id = '00000000-0000-4000-8000-000000000206';

-- 4. Purchase Requests across 5 months (inserted directly with demo_seed source;
--    the AFTER INSERT trigger populates approval_actions & audit_logs automatically)
insert into public.purchase_requests (
  id, request_number, item_name, description, quantity, unit_price,
  department_id, justification, requester_id, required_date, status,
  submitted_at, decided_at, decided_by, decision_comment,
  cancelled_at, cancelled_by, cancel_reason, source, created_at
) values
  -- Month -4 (June 2026)
  (
    '00000000-0000-4000-8000-000000000301', 'PR-2026-00001',
    'Zebra ZD421 Industrial Label Printers',
    'Direct thermal / thermal transfer 203 dpi with Ethernet module for Bekasi warehouse lanes 1-4.',
    4, 6850000.00,
    '00000000-0000-4000-8000-000000000101',
    'Replace legacy printers causing 40-minute daily shipping label bottlenecks on outbound docks.',
    '00000000-0000-4000-8000-000000000201', (current_date - 95), 'approved',
    now() - interval '120 days', now() - interval '119 days 16 hours',
    '00000000-0000-4000-8000-000000000204', 'Approved under Q2 warehouse automation capex budget.',
    null, null, null, 'demo_seed', now() - interval '120 days 2 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000302', 'PR-2026-00002',
    'Ubiquiti UniFi 24-Port PoE+ Switch',
    'Managed Layer-2 switch for floor 3 access points and VoIP phones.',
    2, 9200000.00,
    '00000000-0000-4000-8000-000000000102',
    'Network segmentation and PoE capacity expansion for the new operations control room.',
    '00000000-0000-4000-8000-000000000202', (current_date - 88), 'approved',
    now() - interval '112 days', now() - interval '111 days 18 hours',
    '00000000-0000-4000-8000-000000000205', 'Approved — coordinate maintenance window with facilities.',
    null, null, null, 'demo_seed', now() - interval '112 days 3 hours'
  ),

  -- Month -3 (July 2026)
  (
    '00000000-0000-4000-8000-000000000303', 'PR-2026-00003',
    'Heavy-Duty Hydraulic Pallet Jacks (2.5 Ton)',
    'Galvanized steel frame, tandem polyurethane rollers.',
    5, 4750000.00,
    '00000000-0000-4000-8000-000000000101',
    'Increase staging throughput ahead of Q3 seasonal inventory intake.',
    '00000000-0000-4000-8000-000000000201', (current_date - 65), 'approved',
    now() - interval '92 days', now() - interval '91 days 12 hours',
    '00000000-0000-4000-8000-000000000204', 'Approved. Vendor confirmed 5-day delivery SLA.',
    null, null, null, 'demo_seed', now() - interval '92 days 4 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000304', 'PR-2026-00004',
    'Annual Tax E-Faktur Reconciliation Suite License',
    'Multi-entity VAT & withholding tax reconciliation workbench (10 seats).',
    1, 18500000.00,
    '00000000-0000-4000-8000-000000000103',
    'Automates monthly PPN cross-checks and cuts closing reconciliation by 3 days per month.',
    '00000000-0000-4000-8000-000000000203', (current_date - 60), 'approved',
    now() - interval '85 days', now() - interval '84 days 20 hours',
    '00000000-0000-4000-8000-000000000206', 'Approved by Finance Admin after security review.',
    null, null, null, 'demo_seed', now() - interval '85 days 2 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000305', 'PR-2026-00005',
    'Executive Lounge Espresso Machine',
    'Commercial dual-boiler espresso station.',
    1, 24000000.00,
    '00000000-0000-4000-8000-000000000101',
    'Upgrade breakroom beverage equipment for client visits.',
    '00000000-0000-4000-8000-000000000201', (current_date - 55), 'rejected',
    now() - interval '80 days', now() - interval '79 days 15 hours',
    '00000000-0000-4000-8000-000000000204', 'Non-essential spend; Operations budget is prioritized for safety and dock equipment.',
    null, null, null, 'demo_seed', now() - interval '80 days 1 hour'
  ),

  -- Month -2 (August 2026)
  (
    '00000000-0000-4000-8000-000000000306', 'PR-2026-00006',
    'ThinkPad L14 Gen 5 Field Engineer Laptops',
    'Ryzen 7 PRO, 32GB RAM, 1TB SSD, LTE modem for site supervisors.',
    3, 17900000.00,
    '00000000-0000-4000-8000-000000000102',
    'Equip three newly onboarded regional inventory auditors with ruggedized laptops.',
    '00000000-0000-4000-8000-000000000202', (current_date - 35), 'approved',
    now() - interval '62 days', now() - interval '61 days 14 hours',
    '00000000-0000-4000-8000-000000000205', 'Approved under standard IT hardware refresh catalog.',
    null, null, null, 'demo_seed', now() - interval '62 days 3 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000307', 'PR-2026-00007',
    'Warehouse Safety PPE Kit Replenishment',
    'EN 397 helmets, high-visibility vests, steel-toe boots, and cut-resistant gloves.',
    30, 625000.00,
    '00000000-0000-4000-8000-000000000101',
    'Mandatory semi-annual K3 occupational safety compliance replenishment.',
    '00000000-0000-4000-8000-000000000201', (current_date - 30), 'approved',
    now() - interval '54 days', now() - interval '53 days 19 hours',
    '00000000-0000-4000-8000-000000000204', 'Fast-tracked approval for K3 safety audit compliance.',
    null, null, null, 'demo_seed', now() - interval '54 days 2 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000308', 'PR-2026-00008',
    'Vendor Portal SSL Wildcard Certificate (2-Year)',
    'OV wildcard TLS certificate for *.nusantara-demo.id subdomains.',
    1, 7400000.00,
    '00000000-0000-4000-8000-000000000102',
    'Scheduled renewal before existing certificate expires next month.',
    '00000000-0000-4000-8000-000000000202', (current_date - 25), 'cancelled',
    null, null, null, null,
    now() - interval '48 days', '00000000-0000-4000-8000-000000000202',
    'Replaced by automated ACME DNS-01 certificates at zero cost.',
    'demo_seed', now() - interval '49 days'
  ),

  -- Month -1 (September 2026)
  (
    '00000000-0000-4000-8000-000000000309', 'PR-2026-00009',
    'Honeywell Xenon Ultra 2D Barcode Scanners',
    'Cordless area-imaging scanners with charging cradles for receiving bays.',
    8, 3950000.00,
    '00000000-0000-4000-8000-000000000101',
    'Eliminate manual SKU entry errors during inbound supplier receiving.',
    '00000000-0000-4000-8000-000000000201', (current_date - 10), 'approved',
    now() - interval '32 days', now() - interval '31 days 17 hours',
    '00000000-0000-4000-8000-000000000204', 'Approved — strong ROI on receiving accuracy.',
    null, null, null, 'demo_seed', now() - interval '32 days 2 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000310', 'PR-2026-00010',
    'Cloud Backup Immutable Object Storage (12 TB Annual)',
    'S3-compatible object lock storage for off-site PostgreSQL WAL and ERP snapshots.',
    12, 1450000.00,
    '00000000-0000-4000-8000-000000000102',
    'Disaster recovery compliance requirement for daily off-site encrypted database backups.',
    '00000000-0000-4000-8000-000000000202', (current_date - 5), 'approved',
    now() - interval '25 days', now() - interval '24 days 16 hours',
    '00000000-0000-4000-8000-000000000205', 'Approved — required by ISO 27001 backup policy.',
    null, null, null, 'demo_seed', now() - interval '25 days 3 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000311', 'PR-2026-00011',
    'Unbudgeted Third-Party BI Consultant Retainer',
    'External ad-hoc dashboard consulting package.',
    1, 45000000.00,
    '00000000-0000-4000-8000-000000000102',
    'Outsource custom KPI reporting to external agency.',
    '00000000-0000-4000-8000-000000000202', (current_date + 5), 'rejected',
    now() - interval '21 days', now() - interval '20 days 18 hours',
    '00000000-0000-4000-8000-000000000205', 'Rejected: internal FLOWTRACK analytics already covers operational KPIs without external agency spend.',
    null, null, null, 'demo_seed', now() - interval '21 days 2 hours'
  ),

  -- Current Month (October 2026) — includes active Pending Approvals & Drafts for live demo!
  (
    '00000000-0000-4000-8000-000000000312', 'PR-2026-00012',
    'Digital Platform Scale 500kg with RS-232 Interface',
    'Stainless steel bench scale integrated with dispatch workstation.',
    2, 5600000.00,
    '00000000-0000-4000-8000-000000000101',
    'Automates parcel weight capture at outbound packing stations to prevent carrier surcharges.',
    '00000000-0000-4000-8000-000000000201', (current_date + 12), 'approved',
    now() - interval '10 days', now() - interval '9 days 19 hours',
    '00000000-0000-4000-8000-000000000204', 'Approved. Expect payback within two billing cycles.',
    null, null, null, 'demo_seed', now() - interval '10 days 2 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000313', 'PR-2026-00013',
    'Industrial Rack UPS 3000VA Pure Sinewave',
    'APC Smart-UPS 2U rackmount with network management card for warehouse IDF closet.',
    2, 11400000.00,
    '00000000-0000-4000-8000-000000000101',
    'Protect core barcode & WMS switches from grid voltage sags during monsoon season.',
    '00000000-0000-4000-8000-000000000201', (current_date + 14), 'pending_approval',
    now() - interval '2 days', null, null, null,
    null, null, null, 'demo_seed', now() - interval '2 days 3 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000314', 'PR-2026-00014',
    'Cold-Chain Temperature Data Loggers (USB + BLE)',
    'Calibrated -30C to +70C multi-use loggers with NIST certificate.',
    20, 485000.00,
    '00000000-0000-4000-8000-000000000101',
    'Required by new pharmaceutical distribution client SLA for refrigerated fleet monitoring.',
    '00000000-0000-4000-8000-000000000201', (current_date + 18), 'pending_approval',
    now() - interval '1 day 6 hours', null, null, null,
    null, null, null, 'demo_seed', now() - interval '1 day 8 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000315', 'PR-2026-00015',
    'Dell UltraSharp 27" USB-C Hub Monitors (U2724DE)',
    'QHD IPS Black panel with integrated 90W power delivery and RJ45.',
    6, 7850000.00,
    '00000000-0000-4000-8000-000000000102',
    'Standard dual-display workstation setup for the systems engineering and NOC team.',
    '00000000-0000-4000-8000-000000000202', (current_date + 21), 'pending_approval',
    now() - interval '18 hours', null, null, null,
    null, null, null, 'demo_seed', now() - interval '20 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000316', 'PR-2026-00016',
    'Automated Stretch-Wrap Turntable Spare Rollers Kit',
    'OEM replacement roller bearings and photo-eye sensor kit.',
    3, 2150000.00,
    '00000000-0000-4000-8000-000000000101',
    'Preventive maintenance stock for packing line #2 before year-end peak volume.',
    '00000000-0000-4000-8000-000000000201', (current_date + 25), 'draft',
    null, null, null, null,
    null, null, null, 'demo_seed', now() - interval '6 hours'
  )
on conflict (id) do nothing;

-- Advance the sequence past the seeded numbers so newly created requests start at PR-2026-00017+
select setval('public.purchase_request_number_seq', 16, true);

commit;
