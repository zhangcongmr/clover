import { useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';

export default function App() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Sign in clicked');
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-[340px]">
        {/* GitHub Logo */}
        <div className="flex justify-center mb-6">
          <svg
            height="48"
            aria-hidden="true"
            viewBox="0 0 16 16"
            version="1.1"
            width="48"
            className="fill-[#24292f]"
          >
            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"></path>
          </svg>
        </div>

        {/* Sign in heading */}
        <h1 className="text-2xl text-center mb-4 text-[#24292f]">
          Sign in to GitHub
        </h1>

        {/* Sign in form */}
        <div className="bg-[#f6f8fa] border border-[#d0d7de] rounded-md p-4 mb-4">
          <form onSubmit={handleSignIn}>
            <div className="mb-4">
              <Label
                htmlFor="username"
                className="block text-sm mb-2 text-[#24292f]"
              >
                Username or email address
              </Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-1.5 border border-[#d0d7de] rounded-md bg-white text-[#24292f] focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/20"
              />
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <Label htmlFor="password" className="text-sm text-[#24292f]">
                  Password
                </Label>
                <a
                  href="#"
                  className="text-sm text-[#0969da] hover:underline"
                >
                  Forgot password?
                </a>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-1.5 border border-[#d0d7de] rounded-md bg-white text-[#24292f] focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/20"
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-[#1a7f37] hover:bg-[#1a7f37]/90 text-white py-1.5 rounded-md border border-[#1f883d]/40"
            >
              Sign in
            </Button>
          </form>
        </div>

        {/* Divider */}
        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[#d0d7de]"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-white text-[#57606a]">or</span>
          </div>
        </div>

        {/* OAuth buttons */}
        <div className="space-y-3 mb-4">
          <Button
            variant="outline"
            className="w-full border border-[#d0d7de] bg-white hover:bg-[#f6f8fa] text-[#24292f] py-1.5 rounded-md flex items-center justify-center gap-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              width="16"
              height="16"
            >
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </Button>

          <Button
            variant="outline"
            className="w-full border border-[#d0d7de] bg-white hover:bg-[#f6f8fa] text-[#24292f] py-1.5 rounded-md flex items-center justify-center gap-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="currentColor"
            >
              <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
            Continue with Apple
          </Button>
        </div>

        {/* Create account link */}
        <p className="text-center text-sm text-[#24292f] mb-4">
          New to GitHub?{' '}
          <a href="#" className="text-[#0969da] hover:underline">
            Create an account
          </a>
          .
        </p>

        {/* Passkey link */}
        <p className="text-center text-sm mb-8">
          <a href="#" className="text-[#0969da] hover:underline">
            Sign in with a passkey
          </a>
        </p>
      </div>

      {/* Footer */}
      <footer className="mt-auto py-8">
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-[#0969da]">
          <a href="#" className="hover:underline">
            Terms
          </a>
          <a href="#" className="hover:underline">
            Privacy
          </a>
          <a href="#" className="hover:underline">
            Docs
          </a>
          <a href="#" className="hover:underline">
            Contact GitHub Support
          </a>
          <a href="#" className="hover:underline">
            Manage cookies
          </a>
          <a href="#" className="hover:underline">
            Do not share my personal information
          </a>
        </div>
      </footer>
    </div>
  );
}
