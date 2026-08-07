-- ============================================================================
-- 0040  INDIAN_STATE — full list of states and union territories.
-- ----------------------------------------------------------------------------
-- The enum (0001) held only Maharashtra and Gujarat, so a branch could not be
-- registered anywhere else. This extends it to all 28 states + 8 UTs. Keep
-- INDIAN_STATES in src/lib/constants.ts in lockstep with this list.
--
-- Professional tax: fn_professional_tax (0002) returns 0 when a state has no
-- pt_slabs rows, and only Maharashtra and Gujarat are seeded — so a branch in
-- any newly added state computes PT as nil. That is correct for the many
-- states/UTs that levy no PT (Delhi, Haryana, UP, Rajasthan, …); for a
-- PT-levying state (e.g. Karnataka's flat 200/month) its slab rows must be
-- added before payroll runs there. Deliberately NOT seeded here: slabs change
-- by state budget each year and should be entered against the year's actual
-- rates, not frozen guesses.
--
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is safe inside the db push transaction
-- on Postgres 12+ so long as the new values are not USED in the same
-- transaction — nothing below inserts rows with them.
-- ============================================================================

-- States
alter type indian_state add value if not exists 'Andhra Pradesh';
alter type indian_state add value if not exists 'Arunachal Pradesh';
alter type indian_state add value if not exists 'Assam';
alter type indian_state add value if not exists 'Bihar';
alter type indian_state add value if not exists 'Chhattisgarh';
alter type indian_state add value if not exists 'Goa';
alter type indian_state add value if not exists 'Haryana';
alter type indian_state add value if not exists 'Himachal Pradesh';
alter type indian_state add value if not exists 'Jharkhand';
alter type indian_state add value if not exists 'Karnataka';
alter type indian_state add value if not exists 'Kerala';
alter type indian_state add value if not exists 'Madhya Pradesh';
alter type indian_state add value if not exists 'Manipur';
alter type indian_state add value if not exists 'Meghalaya';
alter type indian_state add value if not exists 'Mizoram';
alter type indian_state add value if not exists 'Nagaland';
alter type indian_state add value if not exists 'Odisha';
alter type indian_state add value if not exists 'Punjab';
alter type indian_state add value if not exists 'Rajasthan';
alter type indian_state add value if not exists 'Sikkim';
alter type indian_state add value if not exists 'Tamil Nadu';
alter type indian_state add value if not exists 'Telangana';
alter type indian_state add value if not exists 'Tripura';
alter type indian_state add value if not exists 'Uttar Pradesh';
alter type indian_state add value if not exists 'Uttarakhand';
alter type indian_state add value if not exists 'West Bengal';

-- Union territories
alter type indian_state add value if not exists 'Andaman and Nicobar Islands';
alter type indian_state add value if not exists 'Chandigarh';
alter type indian_state add value if not exists 'Dadra and Nagar Haveli and Daman and Diu';
alter type indian_state add value if not exists 'Delhi';
alter type indian_state add value if not exists 'Jammu and Kashmir';
alter type indian_state add value if not exists 'Ladakh';
alter type indian_state add value if not exists 'Lakshadweep';
alter type indian_state add value if not exists 'Puducherry';
