import { Button } from '@/app/components/ui/button';
import { Check } from 'lucide-react';

export function PricingSection() {
  const plans = [
    {
      name: 'Free',
      price: '$0',
      description: 'For individuals learning about APIs',
      features: [
        'Access to Clover API Platform',
        'Public workspaces',
        'Collaboration tools',
        '3 team members',
      ],
      cta: 'Sign up for free',
      highlighted: false,
    },
    {
      name: 'Basic',
      price: '$12',
      description: 'For small teams getting started',
      features: [
        'Everything in Free',
        'Private workspaces',
        'Mock servers',
        '10 team members',
        'Email support',
      ],
      cta: 'Start free trial',
      highlighted: true,
    },
    {
      name: 'Professional',
      price: '$29',
      description: 'For teams building production APIs',
      features: [
        'Everything in Basic',
        'Advanced collaboration',
        'API monitoring',
        'Unlimited team members',
        'Priority support',
      ],
      cta: 'Start free trial',
      highlighted: false,
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      description: 'For organizations with advanced needs',
      features: [
        'Everything in Professional',
        'SSO/SAML authentication',
        'Advanced security',
        'Dedicated support',
        'Custom contracts',
      ],
      cta: 'Contact sales',
      highlighted: false,
    },
  ];

  return (
    <section className="bg-white py-20">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Explore our use cases
          </h2>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Whether you're an individual or part of a team, find the plan that's right for you.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
          {plans.map((plan, index) => (
            <div
              key={index}
              className={`rounded-lg p-6 border-2 ${
                plan.highlighted
                  ? 'border-[#FF6C37] bg-orange-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <div className="mb-6">
                <h3 className="text-xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                <div className="mb-2">
                  <span className="text-3xl font-bold text-gray-900">{plan.price}</span>
                  {plan.price !== 'Custom' && <span className="text-gray-600">/month</span>}
                </div>
                <p className="text-sm text-gray-600">{plan.description}</p>
              </div>

              <Button
                className={`w-full mb-6 ${
                  plan.highlighted
                    ? 'bg-[#FF6C37] hover:bg-[#FF5722] text-white'
                    : 'bg-white hover:bg-gray-50 text-gray-900 border-2 border-gray-300'
                }`}
              >
                {plan.cta}
              </Button>

              <ul className="space-y-3">
                {plan.features.map((feature, featureIndex) => (
                  <li key={featureIndex} className="flex items-start gap-2">
                    <Check className="w-5 h-5 text-[#FF6C37] flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
