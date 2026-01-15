import { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { Checkbox } from '@/app/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import { ChevronRight } from 'lucide-react';

export default function App() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [country, setCountry] = useState('Hong Kong');
  const [receiveUpdates, setReceiveUpdates] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Form submitted:', { email, password, username, country, receiveUpdates });
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-[480px]">
        {/* Header */}
        <div className="text-right mb-8">
          <span className="text-sm text-gray-600">Already have an account? </span>
          <a href="#" className="text-sm text-blue-600 hover:underline">
            Sign in →
          </a>
        </div>

        {/* Main Form */}
        <div className="space-y-6">
          <h1 className="text-[28px] font-medium text-gray-900 mb-6">Sign up for GitHub</h1>

          {/* OAuth Buttons */}
          <div className="space-y-3">
            <button
              type="button"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path
                  d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
                  fill="#4285F4"
                />
                <path
                  d="M9.003 18c2.43 0 4.467-.806 5.956-2.18L12.05 13.56c-.806.54-1.836.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.96v2.332C2.438 15.983 5.482 18 9.003 18z"
                  fill="#34A853"
                />
                <path
                  d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.96H.957C.347 6.175 0 7.55 0 9.002c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                  fill="#FBBC05"
                />
                <path
                  d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.426 0 9.003 0 5.482 0 2.438 2.017.96 4.958L3.967 7.29c.708-2.127 2.692-3.71 5.036-3.71z"
                  fill="#EA4335"
                />
              </svg>
              <span className="text-sm font-medium text-gray-700">Continue with Google</span>
            </button>

            <button
              type="button"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                <path d="M14.315 0c.48 3.317-1.144 5.619-3.258 7.577-2.078 1.924-4.054 3.848-3.598 7.423-3.77-.119-6.444-2.715-7.459-6.09C-1.373 5.09.657.964 5.595.012c.06 1.65.897 2.984 2.154 4.056C9.13 5.305 10.85 6.276 12.16 7.88c1.08-2.173.84-4.498.036-6.408.608-.227 1.407-.346 2.119-.472z" />
              </svg>
              <span className="text-sm font-medium text-gray-700">Continue with Apple</span>
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-4">
            <div className="flex-1 border-t border-gray-300"></div>
            <span className="text-sm text-gray-500">or</span>
            <div className="flex-1 border-t border-gray-300"></div>
          </div>

          {/* Registration Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-gray-900">
                Email<span className="text-red-500">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-gray-900">
                Password<span className="text-red-500">*</span>
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
              <p className="text-xs text-gray-600">
                Password should be at least 15 characters OR at least 8 characters including a number and a lowercase letter.
              </p>
            </div>

            {/* Username */}
            <div className="space-y-2">
              <Label htmlFor="username" className="text-sm font-medium text-gray-900">
                Username<span className="text-red-500">*</span>
              </Label>
              <Input
                id="username"
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
              <p className="text-xs text-gray-600">
                Username may only contain alphanumeric characters or single hyphens, and cannot begin or end with a hyphen.
              </p>
            </div>

            {/* Country/Region */}
            <div className="space-y-2">
              <Label htmlFor="country" className="text-sm font-medium text-gray-900">
                Your Country/Region<span className="text-red-500">*</span>
              </Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select your country" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Hong Kong">Hong Kong</SelectItem>
                  <SelectItem value="United States">United States</SelectItem>
                  <SelectItem value="United Kingdom">United Kingdom</SelectItem>
                  <SelectItem value="Canada">Canada</SelectItem>
                  <SelectItem value="Australia">Australia</SelectItem>
                  <SelectItem value="Germany">Germany</SelectItem>
                  <SelectItem value="France">France</SelectItem>
                  <SelectItem value="Japan">Japan</SelectItem>
                  <SelectItem value="Singapore">Singapore</SelectItem>
                  <SelectItem value="India">India</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-600">
                For compliance reasons, we're required to collect country information to send you occasional updates and announcements.
              </p>
            </div>

            {/* Email Preferences */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-900">Email preferences</p>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="updates"
                  checked={receiveUpdates}
                  onCheckedChange={(checked) => setReceiveUpdates(checked as boolean)}
                />
                <label
                  htmlFor="updates"
                  className="text-sm text-gray-700 cursor-pointer"
                >
                  Receive occasional product updates and announcements
                </label>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              className="w-full bg-[#2da44e] hover:bg-[#2c974b] text-white py-2.5 rounded-md font-medium flex items-center justify-center gap-1 transition-colors"
            >
              Create account
              <ChevronRight className="w-4 h-4" />
            </Button>

            {/* Terms */}
            <p className="text-xs text-gray-600">
              By creating an account, you agree to the{' '}
              <a href="#" className="text-blue-600 hover:underline">
                Terms of Service
              </a>
              . For more information about GitHub's privacy practices, see the{' '}
              <a href="#" className="text-blue-600 hover:underline">
                GitHub Privacy Statement
              </a>
              . We'll occasionally send you account-related emails.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
