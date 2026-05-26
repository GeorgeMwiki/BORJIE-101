'use client';

import { useCallback, useState, type ChangeEvent } from 'react';
import { Upload } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { z } from 'zod';

export const kybSchema = z.object({
  companyName: z.string().min(1, 'required'),
  registrationNo: z.string().min(1, 'required'),
  tin: z.string().min(1, 'required'),
  registeredAddress: z.string().min(1, 'required'),
  directorFullName: z.string().min(1, 'required'),
  directorNidaId: z.string().min(8, 'NIDA ≥ 8'),
});
export type KybFormValues = z.infer<typeof kybSchema>;

interface KybStepProps {
  readonly form: UseFormReturn<KybFormValues>;
}

export function KybStep({ form }: KybStepProps) {
  const { register, formState } = form;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <TextField
        label="Company name / Jina la kampuni"
        register={register('companyName')}
        error={formState.errors.companyName?.message}
      />
      <TextField
        label="Registration no. / Namba ya usajili"
        register={register('registrationNo')}
        error={formState.errors.registrationNo?.message}
      />
      <TextField
        label="TIN"
        register={register('tin')}
        error={formState.errors.tin?.message}
      />
      <TextField
        label="Registered address / Anwani"
        register={register('registeredAddress')}
        error={formState.errors.registeredAddress?.message}
      />
      <TextField
        label="Director full name / Jina la mkurugenzi"
        register={register('directorFullName')}
        error={formState.errors.directorFullName?.message}
      />
      <TextField
        label="Director NIDA / Kitambulisho cha NIDA"
        register={register('directorNidaId')}
        error={formState.errors.directorNidaId?.message}
      />
    </div>
  );
}

interface FileUploadStepProps {
  readonly accept: string;
  readonly hintEn: string;
  readonly hintSw: string;
  readonly files: ReadonlyArray<File>;
  readonly onChange: (files: ReadonlyArray<File>) => void;
}

export function FileUploadStep({
  accept,
  hintEn,
  hintSw,
  files,
  onChange,
}: FileUploadStepProps) {
  const [dragActive, setDragActive] = useState<boolean>(false);

  const onPick = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const picked = Array.from(event.target.files ?? []);
      onChange([...files, ...picked]);
    },
    [files, onChange],
  );

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          const dropped = Array.from(event.dataTransfer.files);
          onChange([...files, ...dropped]);
        }}
        className={`flex h-44 flex-col items-center justify-center rounded-md border-2 border-dashed px-4 text-center ${
          dragActive
            ? 'border-warning bg-warning-subtle/20 text-warning'
            : 'border-border bg-background text-neutral-400'
        }`}
      >
        <Upload className="h-6 w-6" />
        <p className="mt-2 text-sm">{hintEn}</p>
        <p className="text-xs italic text-neutral-500">{hintSw}</p>
        <label className="mt-2 cursor-pointer text-xs text-warning underline">
          or choose files / au chagua faili
          <input
            type="file"
            multiple
            accept={accept}
            onChange={onPick}
            className="sr-only"
          />
        </label>
      </div>
      {files.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-neutral-300">
          {files.map((file, idx) => (
            <li key={`${file.name}-${idx}`}>{file.name}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface CockpitSeedStepProps {
  readonly headline: string;
  readonly onChange: (next: string) => void;
}

export function CockpitSeedStep({ headline, onChange }: CockpitSeedStepProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-300">
        Pick a one-line headline for your first daily brief. We'll seed your
        cockpit so it's ready when you finish onboarding.
      </p>
      <p className="text-xs italic text-neutral-500">
        Chagua kichwa kifupi kwa muhtasari wako wa kwanza wa siku.
      </p>
      <label className="block text-sm">
        <span className="block text-xs uppercase tracking-wide text-neutral-500">
          Headline / Kichwa
        </span>
        <input
          type="text"
          value={headline}
          onChange={(event) => onChange(event.target.value)}
          maxLength={256}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-warning"
        />
      </label>
    </div>
  );
}

interface TextFieldProps {
  readonly label: string;
  readonly register: ReturnType<UseFormReturn<KybFormValues>['register']>;
  readonly error?: string;
}

function TextField({ label, register, error }: TextFieldProps) {
  return (
    <label className="block text-sm">
      <span className="block text-xs uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <input
        type="text"
        {...register}
        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-warning"
      />
      {error ? <span className="mt-1 block text-xs text-destructive">{error}</span> : null}
    </label>
  );
}
