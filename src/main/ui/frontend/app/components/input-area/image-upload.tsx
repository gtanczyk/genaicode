import React from 'react';
import styled from 'styled-components';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const MAX_IMAGES = 5;

interface ImageUploadProps {
  images: File[];
  onImagesChange: (newImages: File[]) => void;
  error: string | null;
  setError: (error: string | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({ images, onImagesChange, error, setError, fileInputRef }) => {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter((file) => {
      if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        setError(`Invalid file type: ${file.name}. Allowed types are JPEG, PNG, GIF, and WebP.`);
        return false;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(`File too large: ${file.name}. Maximum size is 5MB.`);
        return false;
      }
      return true;
    });

    if (validFiles.length + images.length > MAX_IMAGES) {
      setError(`Too many images. Maximum ${MAX_IMAGES} images allowed.`);
      return;
    }

    onImagesChange([...images, ...validFiles]);
    setError(null);
  };

  const removeImage = (index: number) => {
    const newImages = images.filter((_, i) => i !== index);
    onImagesChange(newImages);
  };

  return (
    <ImageUploadContainer>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      <ImagePreviewContainer>
        {images.map((image, index) => (
          <ImagePreview key={index}>
            <img src={URL.createObjectURL(image)} alt={`Uploaded ${index + 1}`} />
            <RemoveButton onClick={() => removeImage(index)}>×</RemoveButton>
          </ImagePreview>
        ))}
      </ImagePreviewContainer>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
        accept={ALLOWED_FILE_TYPES.join(',')}
        multiple
      />
    </ImageUploadContainer>
  );
};

const ImageUploadContainer = styled.div`
  margin-bottom: 8px;
`;

const ErrorMessage = styled.div`
  color: ${(props) => props.theme.colors.error};
  font-size: 14px;
  margin-bottom: 8px;
`;

const ImagePreviewContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const ImagePreview = styled.div`
  position: relative;
  width: 60px;
  height: 60px;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 4px;
  }
`;

const RemoveButton = styled.button`
  position: absolute;
  top: -8px;
  right: -8px;
  background-color: ${(props) => props.theme.colors.error};
  color: white;
  border: none;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background-color: ${(props) => props.theme.colors.errorHover};
  }
`;
