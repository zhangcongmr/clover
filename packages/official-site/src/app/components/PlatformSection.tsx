export function PlatformSection() {
  const platforms = [
    { name: 'Mac', icon: '🍎' },
    { name: 'Windows', icon: '🪟' },
    { name: 'Linux', icon: '🐧' },
    { name: 'Web', icon: '🌐' },
    { name: 'CLI', icon: '⌨️' },
    { name: 'VS Code', icon: '💻' },
    { name: 'IntelliJ', icon: '🧠' },
    { name: 'Chrome', icon: '🔍' },
  ];

  return (
    <section className="bg-gray-50 py-20">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Connect Clover to your favorite tools
          </h2>
          <p className="text-gray-600 text-lg max-w-2xl mx-auto">
            Download our native apps or use Clover on the web. Available on all major platforms and integrated with your favorite development tools.
          </p>
        </div>

        <div className="flex flex-wrap justify-center items-center gap-8 max-w-4xl mx-auto">
          {platforms.map((platform, index) => (
            <div
              key={index}
              className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg border border-gray-200 hover:border-[#FF6C37] transition-colors cursor-pointer"
            >
              <span className="text-2xl">{platform.icon}</span>
              <span className="font-medium text-gray-900">{platform.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
