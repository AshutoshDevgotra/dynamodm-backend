import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';



export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction): void => {
  const statusCode = err.statusCode || (err.code === 11000 ? 409 : err.name === 'ValidationError' ? 400 : 500);
  const message = err.isOperational ? err.message : err.code === 11000 ? 'A record with that value already exists.' : err.name === 'ValidationError' ? 'Invalid request data.' : 'Internal server error';
  // #region agent log
  fetch('http://127.0.0.1:7811/ingest/f30bae55-2bf1-4e72-b7d4-c3f427538ba8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5bf7a1'},body:JSON.stringify({sessionId:'5bf7a1',runId:'pre-fix',hypothesisId:'D',location:'errorHandler.ts',message:'error handler invoked',data:{url:req.originalUrl,method:req.method,name:err?.name,errMessage:err?.message,status:err?.status,statusCode:err?.statusCode,computedStatus:statusCode,isOperational:err?.isOperational,code:err?.code},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  logger.error({
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    statusCode,
  });

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export const notFound = (req: Request, res: Response): void => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found.` });
};

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}
