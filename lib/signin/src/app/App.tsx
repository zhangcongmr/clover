import { useEffect, useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';

interface MyReactComponentProps {
  baseHref?: string
  onAction?: (data: any) => void; // 建议更具体的类型，如 { id: string; value: string }
}

export default function App({baseHref, onAction} : MyReactComponentProps) {
  baseHref = baseHref == null ? "" : baseHref;
  baseHref = baseHref.replace(/\/+$/, '');  //去掉末尾的/

  const [loginId, setLoginId] = useState(''); // 用户输入 username 或 email
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // 在 React 组件中
  useEffect(() => {
    const fetchCsrf = async () => {
      const result = await fetch('/api/csrf', { credentials: 'include' }); // 触发 Set-Cookie: XSRF-TOKEN
    };
    fetchCsrf();
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();

    setError(null);

    // 基本前端校验（可选）
    if (!loginId || !password) {
      setError('请填写所有必填字段');
      return;
    }
    // 从 Cookie 中读取 XSRF-TOKEN（Spring 默认写入此 Cookie）
    const csrfToken = document.cookie
      .split('; ')
      .find(row => row.startsWith('XSRF-TOKEN='))
      ?.split('=')[1];

    try {
      const response = await fetch(`${baseHref}/api/auth/signin`, {
        method: 'POST',
        credentials: 'include', // 携带 Cookie
        headers: { 
          'Content-Type': 'application/json',
          'X-XSRF-TOKEN': csrfToken || '', // 关键：放入请求头
         },
        body: JSON.stringify({ loginId, password }),
      });
      const data = await response.json();
      if (response.ok) {
        console.log('Sign in successful', data);
        if (onAction) onAction(data);

        // 2. 获取保存的跳转地址
        const redirectUrl = sessionStorage.getItem('redirect_after_login');

        // 3. 清除记录（防止重复使用）
        sessionStorage.removeItem('redirect_after_login');

        if(redirectUrl) {
          // 4. 跳转
          window.location.href = redirectUrl;
        } else {
          // 默认登录成功后跳转到指定页面
          window.location.href = '/home/';
        }

      } else {
        console.error('Sign in failed:', data.message || 'Unknown error');
        // 后端返回错误信息
        setError(data.message);
      }
    } catch (error) {
      console.error('Sign in error:', error);
    }
  };

  const handleGoogleSignIn = () => {
    window.location.href = `${baseHref}/api/auth/google`;
  };

  const handleAppleSignIn = () => {
    window.location.href = `${baseHref}/api/auth/apple`;
  };

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-[340px]">
        {/* Luxio Logo */}
        <div className="flex justify-center mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
            <defs></defs>
            <rect width="100%" height="100%" fill="rgb(103, 137, 186)" />
            <g transform="matrix(1.25,0,0,1.25,-2.5,-2.5)" fill="#ffffff">
              <path d="M84.06,50.003C87.751,45.762,90,40.231,90,34.167C90,20.82,79.18,10,65.833,10C59.769,10,54.241,12.249,50,15.938C45.755,12.249,40.231,10,34.167,10C20.82,10,10,20.82,10,34.167c0,6.064,2.249,11.592,5.938,15.833C12.249,54.241,10,59.769,10,65.833C10,79.18,20.82,90,34.167,90c6.064,0,11.588-2.249,15.833-5.938C54.241,87.751,59.769,90,65.833,90C79.18,90,90,79.18,90,65.833c0-6.064-2.249-11.592-5.938-15.833L84.06,50.003z M83.333,34.167c0,9.648-7.852,17.5-17.5,17.5c-4.388,0-8.355-1.68-11.429-4.362c2.468-3.782,3.929-8.281,3.929-13.138c0-4.857-1.445-9.369-3.909-13.154c3.069-2.673,7.031-4.346,11.409-4.346C75.481,16.667,83.333,24.519,83.333,34.167z M34.167,16.667c9.648,0,17.5,7.852,17.5,17.5c0,4.388-1.68,8.355-4.355,11.432c-3.786-2.471-8.288-3.932-13.145-3.932c-4.857,0-9.369,1.445-13.158,3.912c-2.669-3.072-4.342-7.034-4.342-11.412C16.667,24.519,24.519,16.667,34.167,16.667z M16.667,65.833c0-9.648,7.852-17.5,17.5-17.5c4.388,0,8.355,1.68,11.432,4.359c-2.471,3.785-3.932,8.284-3.932,13.141c0,4.857,1.445,9.369,3.912,13.154c-3.072,2.673-7.031,4.346-11.412,4.346C24.519,83.333,16.667,75.481,16.667,65.833z M65.833,83.333c-9.648,0-17.5-7.852-17.5-17.5c0-4.388,1.68-8.355,4.355-11.432c3.786,2.471,8.288,3.932,13.145,3.932c4.857,0,9.369-1.445,13.158-3.912c2.669,3.072,4.342,7.034,4.342,11.412C83.333,75.481,75.481,83.333,65.833,83.333z" />
            </g>
          </svg>
        </div>

        {/* Sign in heading */}
        <h1 className="text-2xl text-center mb-4 text-[#24292f]">
          Sign in to Luxio
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
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                className="w-full px-3 py-1.5 border border-[#d0d7de] rounded-md bg-white text-[#24292f] focus:border-[#0969da] focus:ring-2 focus:ring-[#0969da]/20"
              />
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <Label htmlFor="password" className="text-sm text-[#24292f]">
                  Password
                </Label>
                <a
                  href="/forgotpassword"
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
            {error && <p style={{ color: 'red' }}>{error}</p>}
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
            onClick={handleGoogleSignIn}
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
            onClick={handleAppleSignIn}
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
          New to Luxio?{' '}
          <a href="/signup" className="text-[#0969da] hover:underline">
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
    </div>
  );
}