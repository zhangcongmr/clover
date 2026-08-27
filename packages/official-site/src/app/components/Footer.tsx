export function Footer() {
  const footerSections = [
    {
      title: 'Products',
      links: ['API Platform', 'API Repository', 'Tools', 'Intelligence', 'Integrations', 'Pricing'],
    },
    {
      title: 'Use Cases',
      links: ['API-first development', 'API testing', 'API documentation', 'API monitoring', 'API mocking'],
    },
    {
      title: 'Resources',
      links: ['Learning Center', 'Blog', 'Webinars', 'Community', 'API Network', 'Events'],
    },
    {
      title: 'Company',
      links: ['About', 'Careers', 'Press', 'Contact', 'Partners', 'Legal'],
    },
  ];

  return (
    <footer className="bg-[#1a1a1a] text-white py-16">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-12">
          {/* Logo section */}
          <div className="col-span-2 md:col-span-4 lg:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-[#FF6C37] flex items-center justify-center">
                <div className="w-5 h-5 rounded-full border-2 border-white"></div>
              </div>
              <span className="font-semibold text-lg">Clover</span>
            </div>
            <p className="text-sm text-gray-400 mb-4">
              The Collaboration Platform for API Development
            </p>
            <div className="flex gap-4">
              {['Twitter', 'GitHub', 'LinkedIn', 'YouTube'].map((social) => (
                <a key={social} href="#" className="text-gray-400 hover:text-white transition-colors">
                  <span className="text-xs">{social[0]}</span>
                </a>
              ))}
            </div>
          </div>

          {/* Footer links */}
          {footerSections.map((section, index) => (
            <div key={index}>
              <h3 className="font-semibold mb-4">{section.title}</h3>
              <ul className="space-y-2">
                {section.links.map((link, linkIndex) => (
                  <li key={linkIndex}>
                    <a href="#" className="text-sm text-gray-400 hover:text-white transition-colors">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="pt-8 border-t border-gray-800">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm text-gray-400">
              © 2026 Clover, Inc. All rights reserved.
            </p>
            <div className="flex gap-6">
              <a href="#" className="text-sm text-gray-400 hover:text-white transition-colors">
                Privacy Policy
              </a>
              <a href="#" className="text-sm text-gray-400 hover:text-white transition-colors">
                Terms of Use
              </a>
              <a href="#" className="text-sm text-gray-400 hover:text-white transition-colors">
                Security
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
