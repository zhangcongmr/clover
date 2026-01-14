import { Button } from '@/app/components/ui/button';

export function CTASection() {
  return (
    <section className="bg-gradient-to-br from-[#2C1810] to-[#1a0f0a] py-20">
      <div className="container mx-auto px-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-xl p-12 text-center shadow-2xl">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              Try Assistant for free
            </h2>
            <p className="text-gray-600 text-lg mb-8 max-w-2xl mx-auto">
              Join 30+ million developers using Assistant to build and test APIs. Sign up for free and start exploring the platform today.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button className="bg-[#FF6C37] hover:bg-[#FF5722] text-white px-8 py-6 text-lg">
                Sign Up for Free
              </Button>
              <Button variant="outline" className="px-8 py-6 text-lg border-2">
                Contact Sales
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
