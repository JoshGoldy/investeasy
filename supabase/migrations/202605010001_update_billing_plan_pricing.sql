update public.billing_plans
set
  price_zar = case tier
    when 'basic' then 199.00
    when 'pro' then 399.00
    when 'enterprise' then 799.00
    else price_zar
  end,
  monthly_credits = case tier
    when 'basic' then 50
    when 'pro' then 100
    when 'enterprise' then 300
    else monthly_credits
  end,
  description = case tier
    when 'basic' then 'Starter AI access with monthly credits.'
    when 'pro' then 'Full FinBot access with a larger monthly credit pool.'
    when 'enterprise' then 'Highest monthly credit pool and premium support.'
    else description
  end,
  updated_at = now()
where tier in ('basic', 'pro', 'enterprise');
